import { invoke } from '@tauri-apps/api/core';

export type RoomSocketPort = Pick<WebSocket, 'readyState' | 'onopen' | 'onmessage' | 'onclose' | 'close'> & {
  send(data: string): void | Promise<void>;
};

type RoomEvent = { type: 'open' | 'reconnecting' | 'reconnected' } | { type: 'message'; data: string } | { type: 'close'; code: number };
let lifecycle = Promise.resolve();

function nativeLifecycle(operation: () => Promise<void>) {
  const result = lifecycle.then(operation);
  lifecycle = result.catch(() => {});
  return result;
}

/** Native transport answers WebSocket ping independent of WebView timers. */
export class AndroidRoomSocket implements RoomSocketPort {
  readyState: number = WebSocket.CONNECTING;
  onopen: WebSocket['onopen'] = null;
  onmessage: WebSocket['onmessage'] = null;
  onclose: WebSocket['onclose'] = null;
  onreconnecting?: () => void;
  onreconnected?: () => void;
  private socketId = crypto.randomUUID();
  get nativeSocketId() { return this.socketId; }

  constructor(url: string) {
    void nativeLifecycle(async () => {
      if (this.readyState === WebSocket.CLOSED) return;
      await invoke('plugin:android-playback|room_connect', { socketId: this.socketId, url, origin: window.location.origin });
    }).then(() => this.receive()).catch(error => {
      this.finish(String(error) === 'ROOM_CONTROL_URL_INVALID' ? 4003 : 1006);
    });
  }

  async send(data: string) {
    if (this.readyState !== WebSocket.OPEN) throw new Error('控制连接未就绪');
    await invoke('plugin:android-playback|room_send', { socketId: this.socketId, data });
  }

  close() {
    this.readyState = WebSocket.CLOSED;
    void nativeLifecycle(() => invoke('plugin:android-playback|room_close', { socketId: this.socketId })).catch(() => {});
  }

  private finish(code: number) {
    if (this.readyState === WebSocket.CLOSED) return;
    this.close();
    if (this.onclose) Reflect.apply(this.onclose, this, [new CloseEvent('close', { code })]);
  }

  private async receive() {
    while (this.readyState !== WebSocket.CLOSED) {
      const event = await invoke<RoomEvent | null>('plugin:android-playback|room_receive', { socketId: this.socketId });
      if (Number(this.readyState) === WebSocket.CLOSED) return;
      if (!event) continue;
      if (event.type === 'open') {
        this.readyState = WebSocket.OPEN;
        if (this.onopen) Reflect.apply(this.onopen, this, [new Event('open')]);
      } else if (event.type === 'message') {
        if (this.onmessage) Reflect.apply(this.onmessage, this, [new MessageEvent('message', { data: event.data })]);
      } else if (event.type === 'reconnecting') {
        this.onreconnecting?.();
      } else if (event.type === 'reconnected') {
        this.onreconnected?.();
      } else if (event.type === 'close') {
        this.finish(event.code);
        return;
      }
    }
  }
}
