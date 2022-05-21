import MessageObject from './messageObject';
import StringDataObject from './stringDataObject';
import { idStore, LogListStore, logStore } from './store';
import type { WS } from './ws';
import { modifyBandwidth } from './utils/bandwidth';

/**
 * Class for WebRTC datachannel connection
 */
export class RTC {
  private readonly CONFIG: RTCConfiguration = { 'iceServers': [{ 'urls': 'stun:stun.1.google.com:19302' }] };
  private peerConnection: RTCPeerConnection;
  private dataChannel: RTCDataChannel;
  private logStore: LogListStore;
  private ws: WS;
  private localId: string;
  private remoteId: string;
  /**
   * Creates a new RTCPeerConnection instance, and adds event listeners for icecandidate, connectionstatechange and datachannel.
   */
  constructor(ws: WS, remoteId: string) {
    this.logStore = new LogListStore(logStore);
    this.ws = ws;
    this.remoteId = remoteId;
    idStore.subscribe((id) => {
      this.localId = id;
    });
    this.peerConnection = new RTCPeerConnection(this.CONFIG);
    this.dataChannel = this.peerConnection.createDataChannel('File Transfer', {
      negotiated: true,
      id: 0
    });
    this.dataChannel.binaryType = 'arraybuffer';
    this.dataChannel.onopen = () => {
      this.logStore.pushWithCurrentTimeStamp('RTC Data Channel is open');
    };
    this.dataChannel.onmessage = (event: MessageEvent) => { this.handleMessage(event); };
    this.peerConnection.onicecandidate = (event: RTCPeerConnectionIceEvent) => { this.elIceCandidate(event); }; // Ice Candidate update event
    this.peerConnection.onconnectionstatechange = () => { this.elConnectionStateChange(); }; // Connection state update event
    this.logStore.pushWithCurrentTimeStamp('New RTC Instance created');
  }
  private elIceCandidate(event: RTCPeerConnectionIceEvent): void {
    if (!event.candidate) return;
    const offerObj: string = new StringDataObject(this.localId, this.remoteId, JSON.stringify(event.candidate)).toString();
    const messageObj: string = new MessageObject('IceCandidate', offerObj).toString();
    this.ws.sendMessage(messageObj);
    this.logStore.pushWithCurrentTimeStamp('New local ICE Candidate detected');
  }
  private elConnectionStateChange(): void {
    this.logStore.pushWithCurrentTimeStamp(`Connection state changed: ${this.peerConnection.connectionState}`);
  }
  /**
   * Creates a local SDP
   * @returns Local SDP
   */
  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.peerConnection.createOffer({
      iceRestart: false,
      offerToReceiveAudio: false,
      offerToReceiveVideo: false
    });
    const modifiedOffer = modifyBandwidth(offer);
    await this.peerConnection.setLocalDescription(offer);
    this.logStore.pushWithCurrentTimeStamp('Local SDP created');
    return offer;
  }
  /**
   * Called when receiving an offer. Sets the offer from the first argument as a remote SDP, then creates an answer.
   * @param offer the offer from a remote peer
   * @returns Local SDP
   */
  public async createAnswer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.peerConnection.setRemoteDescription(offer);
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    return answer;
  }
  /**
   * Called when receiving an answer. Sets the answer as a remote SDP
   * @param sdp the answer from a remote peer
   */
  public async handleAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    const remoteDesc = new RTCSessionDescription(sdp);
    await this.peerConnection.setRemoteDescription(remoteDesc);
  }
  public handleMessage(event: MessageEvent): void {
    this.logStore.pushWithCurrentTimeStamp(`Received a message from peer ID: ${this.remoteId}`);
    console.log('data: ', event.data);
  }
  public send(data: string): void;
  public send(data: Blob): void;
  public send(data: ArrayBuffer): void;
  public send(data: ArrayBufferView): void;
  public send(data: any): void {
    if (this.dataChannel.readyState === 'open') {
      this.dataChannel.send(data);
      return;
    };
    setTimeout(() => {
      this.send(data);
    }, 2000);
  }
  public async addIceCandidate(ic: RTCIceCandidate): Promise<void> {
    this.peerConnection.addIceCandidate(ic).catch((err) => {
      this.logStore.pushWithCurrentTimeStamp('Something went wrong during adding a new ICE candidate');
      throw Error(err);
    });
  }
};
