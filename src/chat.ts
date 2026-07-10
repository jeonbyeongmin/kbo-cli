// 경기별 실시간 채팅 — MQTT 공개 브로커(broker.hivemq.com)에 얹는 방식.
// 서버 운영 없이 참여자 전원이 브로커로 outbound 연결만 맺으면 되므로 NAT 뒤에서도
// 동작한다. 의존성 금지 규칙 때문에 mqtt 패키지 대신 node:net 위에 MQTT 3.1.1 의
// 최소 부분집합(CONNECT/SUBSCRIBE/PUBLISH QoS0/PING)만 직접 구현한다.
//
// 공개 브로커 특성상 인증이 없고 토픽을 아는 누구나 읽고 쓸 수 있다 — 같은 경기를
// 보는 사람들의 오픈 채팅이라는 용도에 맞고, 민감한 대화 용도가 아니다.

import crypto from "node:crypto";
import net from "node:net";

const MQTT_HOST = "broker.hivemq.com";
const MQTT_PORT = 1883;
const KEEPALIVE_SEC = 60;
const CONNECT_TIMEOUT_MS = 8_000;
const RECONNECT_DELAY_MS = 4_000;
// 공개 브로커라 임의 payload 가 올 수 있다 — 상한을 넘으면 통째로 무시.
const MAX_PAYLOAD_BYTES = 2_048;
const MAX_NICK_CHARS = 20;
const MAX_TEXT_CHARS = 300;

export const CHAT_TOPIC_PREFIX = "kbo-cli/chat/v1";

export interface ChatMessage {
  nick: string;
  text: string;
  ts: number;
}

export type ChatConnState = "connecting" | "connected" | "reconnecting" | "closed";

interface ChatClientOpts {
  nick: string;
  onMessage: (msg: ChatMessage) => void;
  onState: (state: ChatConnState) => void;
}

// 외부에서 온 문자열 방어 — 터미널 escape 주입을 막기 위해 C0/C1 제어문자 제거.
// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어문자 제거가 목적
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

// trim 은 하지 않는다 — watch 의 키 입력 버퍼가 공백 단위 chunk 로 들어오기 때문.
export function sanitizeChatText(s: string, maxChars: number): string {
  return [...s.replace(CONTROL_RE, "")].slice(0, maxChars).join("");
}

function parseChatPayload(payload: Buffer): ChatMessage | null {
  if (payload.length > MAX_PAYLOAD_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(payload.toString("utf8"));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const { nick, text, ts } = raw as { nick?: unknown; text?: unknown; ts?: unknown };
  if (typeof nick !== "string" || typeof text !== "string") return null;
  const cleanNick = sanitizeChatText(nick, MAX_NICK_CHARS).trim();
  const cleanText = sanitizeChatText(text, MAX_TEXT_CHARS).trim();
  if (!cleanNick || !cleanText) return null;
  return { nick: cleanNick, text: cleanText, ts: typeof ts === "number" ? ts : Date.now() };
}

// ─── MQTT 3.1.1 인코딩 ──────────────────────────────────────────

function encodeString(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([Buffer.from([b.length >> 8, b.length & 0xff]), b]);
}

function encodeVarint(n: number): Buffer {
  const bytes: number[] = [];
  let v = n;
  do {
    let byte = v % 128;
    v = Math.floor(v / 128);
    if (v > 0) byte |= 0x80;
    bytes.push(byte);
  } while (v > 0);
  return Buffer.from(bytes);
}

export class ChatClient {
  state: ChatConnState = "connecting";

  private readonly opts: ChatClientOpts;
  private topic: string | null = null;
  private sock: net.Socket | null = null;
  private buf = Buffer.alloc(0);
  private packetId = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  // IPv4 우선 — 반쪽짜리 IPv6 망에서 기본 lookup 이 AAAA 를 먼저 집어 타임아웃
  // 나는 사례가 흔하다 (autoSelectFamily 도 환경에 따라 실패). TCP 연결 자체가
  // 안 되면 다음 시도는 IPv6 로 교대해 IPv6-only 망도 커버한다.
  private family: 4 | 6 = 4;

  constructor(opts: ChatClientOpts) {
    this.opts = opts;
  }

  connect(topic: string): void {
    this.topic = topic;
    this.openSocket();
  }

  // 경기 전환 시 채팅방(토픽)만 갈아탄다 — TCP 연결은 유지.
  setTopic(topic: string): void {
    if (this.topic === topic) return;
    const prev = this.topic;
    this.topic = topic;
    if (this.state !== "connected" || !this.sock) return;
    if (prev) {
      const pid = this.nextPacketId();
      this.writePacket(
        0xa2,
        Buffer.concat([Buffer.from([pid >> 8, pid & 0xff]), encodeString(prev)])
      );
    }
    this.subscribe();
  }

  // 연결돼 있으면 발행 후 true. 화면 표시는 브로커가 되돌려주는 echo 로 한다 —
  // 내 메시지가 보인다 = 실제로 전파됐다는 확인.
  send(text: string): boolean {
    if (this.state !== "connected" || !this.sock || !this.topic) return false;
    const clean = sanitizeChatText(text, MAX_TEXT_CHARS).trim();
    if (!clean) return false;
    const msg: ChatMessage = { nick: this.opts.nick, text: clean, ts: Date.now() };
    this.writePacket(
      0x30,
      Buffer.concat([encodeString(this.topic), Buffer.from(JSON.stringify(msg))])
    );
    return true;
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.teardownSocket();
    this.setState("closed");
  }

  private setState(next: ChatConnState): void {
    if (this.state === next) return;
    this.state = next;
    this.opts.onState(next);
  }

  private nextPacketId(): number {
    this.packetId = (this.packetId % 0xffff) + 1;
    return this.packetId;
  }

  private openSocket(): void {
    if (this.closed) return;
    this.teardownSocket();
    this.buf = Buffer.alloc(0);
    this.setState(this.sockEverConnected ? "reconnecting" : "connecting");

    const sock = net.connect({ host: MQTT_HOST, port: MQTT_PORT, family: this.family });
    this.sock = sock;
    let tcpConnected = false;
    sock.setTimeout(CONNECT_TIMEOUT_MS, () => sock.destroy(new Error("connect timeout")));
    sock.on("connect", () => {
      tcpConnected = true;
      sock.setTimeout(0);
      this.mqttConnect();
    });
    sock.on("data", (chunk: Buffer) => this.onData(chunk));
    sock.on("error", () => {
      /* close 가 뒤따라온다 */
    });
    sock.on("close", () => {
      if (this.sock !== sock) return;
      this.stopPing();
      this.sock = null;
      if (this.closed) return;
      if (!tcpConnected) this.family = this.family === 4 ? 6 : 4;
      this.setState("reconnecting");
      this.reconnectTimer = setTimeout(() => this.openSocket(), RECONNECT_DELAY_MS);
    });
  }

  private sockEverConnected = false;

  private teardownSocket(): void {
    this.stopPing();
    if (this.sock) {
      this.sock.removeAllListeners();
      this.sock.destroy();
      this.sock = null;
    }
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private writePacket(firstByte: number, body: Buffer): void {
    this.sock?.write(Buffer.concat([Buffer.from([firstByte]), encodeVarint(body.length), body]));
  }

  private mqttConnect(): void {
    const clientId = `kbo-cli-${crypto.randomBytes(4).toString("hex")}`;
    const varHeader = Buffer.concat([
      encodeString("MQTT"),
      // protocol level 4 (3.1.1) · clean session · keepalive
      Buffer.from([4, 0x02, KEEPALIVE_SEC >> 8, KEEPALIVE_SEC & 0xff]),
    ]);
    this.writePacket(0x10, Buffer.concat([varHeader, encodeString(clientId)]));
  }

  private subscribe(): void {
    if (!this.topic) return;
    const pid = this.nextPacketId();
    this.writePacket(
      0x82,
      Buffer.concat([
        Buffer.from([pid >> 8, pid & 0xff]),
        encodeString(this.topic),
        Buffer.from([0]),
      ])
    );
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      if (this.buf.length < 2) return;
      // remaining length varint (최대 4바이트)
      let len = 0;
      let mul = 1;
      let pos = 1;
      for (;;) {
        if (pos >= this.buf.length) return; // 아직 덜 옴
        const b = this.buf[pos]!;
        len += (b & 0x7f) * mul;
        mul *= 128;
        pos++;
        if ((b & 0x80) === 0) break;
        if (pos > 4) {
          this.sock?.destroy(new Error("malformed packet"));
          return;
        }
      }
      if (this.buf.length < pos + len) return;
      const type = this.buf[0]! >> 4;
      const flags = this.buf[0]! & 0x0f;
      const body = this.buf.subarray(pos, pos + len);
      this.buf = this.buf.subarray(pos + len);
      this.handlePacket(type, flags, body);
    }
  }

  private handlePacket(type: number, flags: number, body: Buffer): void {
    if (type === 2) {
      // CONNACK — return code 0 이어야 성공.
      if (body.length >= 2 && body[1] === 0) {
        this.sockEverConnected = true;
        this.setState("connected");
        this.subscribe();
        this.pingTimer = setInterval(
          () => this.writePacket(0xc0, Buffer.alloc(0)),
          (KEEPALIVE_SEC / 2) * 1000
        );
      } else {
        this.sock?.destroy(new Error(`CONNACK rc=${body[1]}`));
      }
      return;
    }
    if (type === 3) {
      // PUBLISH — QoS0 구독이지만 방어적으로 QoS>0 헤더도 스킵.
      if (body.length < 2) return;
      const topicLen = body.readUInt16BE(0);
      const qos = (flags >> 1) & 0x03;
      const payloadStart = 2 + topicLen + (qos > 0 ? 2 : 0);
      if (body.length < payloadStart) return;
      const msg = parseChatPayload(body.subarray(payloadStart));
      if (msg) this.opts.onMessage(msg);
      return;
    }
    // SUBACK(9) / UNSUBACK(11) / PINGRESP(13) — 무시.
  }
}
