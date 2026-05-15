import { RTCPeerConnection, MediaStreamTrack } from 'werift';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { EventEmitter } from 'node:events';

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

export class MediaPipeline extends EventEmitter {
  private pc: RTCPeerConnection | null = null;
  private ffmpegProcess: any = null;

  constructor() {
    super();
  }

  async createPeerConnection(offer: string): Promise<string> {
    this.pc = new RTCPeerConnection({
      codecs: {
        video: [
          {
            mimeType: 'video/H264',
            clockRate: 90000,
            payloadType: 102,
            rtcpFeedback: [
              { type: 'nack' },
              { type: 'nack', parameter: 'pli' },
              { type: 'goog-remb' },
            ],
          },
        ],
      },
    });

    this.pc.onTrack.subscribe((track: MediaStreamTrack) => {
      if (track.kind === 'video') {
        this.startFfmpegPipeline(track);
      }
    });

    await this.pc.setRemoteDescription({ type: 'offer', sdp: offer });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    return answer.sdp!;
  }

  private startFfmpegPipeline(track: any) {
    console.log('[MediaPipeline] Starting FFmpeg pipeline to Virtual Camera and TCP broadcast');

    // Virtual Camera Pipeline
    this.ffmpegProcess = ffmpeg()
      .input(track)
      .inputFormat('rtp')
      .outputFormat('dshow')
      .videoCodec('rawvideo')
      .pixelFormat('yuv420p')
      .output('video=OBS Virtual Camera')
      .on('start', (cmd) => console.log('[FFmpeg VirtualCam] Started:', cmd))
      .on('error', (err) => console.error('[FFmpeg VirtualCam] Error:', err.message));

    // RTSP/TCP Fallback Pipeline (MPEG-TS over TCP)
    // OBS can connect to tcp://127.0.0.1:8554
    this.ffmpegProcess
      .output('tcp://127.0.0.1:8554?listen')
      .outputFormat('mpegts')
      .videoCodec('libx264')
      .outputOptions(['-preset ultrafast', '-tune zerolatency'])
      .on('start', () => console.log('[FFmpeg Broadcast] Listening on tcp://127.0.0.1:8554'))
      .run();
  }

  stop() {
    this.ffmpegProcess?.kill();
    this.pc?.close();
  }
}
