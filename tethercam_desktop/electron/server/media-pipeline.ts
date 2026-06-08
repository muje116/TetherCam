import { RTCPeerConnection, MediaStreamTrack } from 'werift';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { EventEmitter } from 'node:events';
import os from 'node:os';

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

export class MediaPipeline extends EventEmitter {
  private pc: RTCPeerConnection | null = null;
  private ffmpegProcess: any = null;
  private rtspServer: any = null;

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
        audio: [
          {
            mimeType: 'audio/OPUS',
            clockRate: 48000,
            payloadType: 111,
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

  private getPlatformOutputs(): string[] {
    const platform = os.platform();
    switch (platform) {
      case 'win32':
        return ['video=OBS Virtual Camera', 'audio=Virtual Cable'];
      case 'darwin':
        return ['video=TetherCam', 'audio=BlackHole'];
      case 'linux':
        return ['video=/dev/video10', 'audio=null_sink'];
      default:
        return ['video=/dev/video10', 'audio=null_sink'];
    }
  }

  private startFfmpegPipeline(track: any) {
    console.log('[MediaPipeline] Starting FFmpeg pipeline to Virtual Camera + RTSP');

    this.ffmpegProcess = ffmpeg()
      .input(track)
      .inputFormat('rtp');

    const platform = os.platform();

    if (platform === 'win32') {
      this.ffmpegProcess
        .outputFormat('dshow')
        .videoCodec('rawvideo')
        .pixelFormat('yuv420p')
        .output('video=OBS Virtual Camera');
    } else if (platform === 'darwin') {
      this.ffmpegProcess
        .outputFormat('avfoundation')
        .videoCodec('rawvideo')
        .pixelFormat('yuv420p')
        .output('TetherCam');
    } else {
      this.ffmpegProcess
        .outputFormat('v4l2')
        .videoCodec('rawvideo')
        .pixelFormat('yuv420p')
        .output('/dev/video10');
    }

    this.ffmpegProcess
      .output(`tcp://127.0.0.1:8554?listen`)
      .outputFormat('mpegts')
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-preset ultrafast',
        '-tune zerolatency',
        '-threads 2',
      ])
      .on('start', (cmd: string) => console.log('[FFmpeg VirtualCam + Broadcast] Started:', cmd))
      .on('error', (err: Error) => console.error('[FFmpeg] Error:', err.message));

    this.ffmpegProcess.run();
  }

  async createAudioPeerConnection(offer: string): Promise<string> {
    const audioPc = new RTCPeerConnection({
      codecs: {
        audio: [
          {
            mimeType: 'audio/OPUS',
            clockRate: 48000,
            payloadType: 111,
          },
        ],
      },
    });

    audioPc.onTrack.subscribe((track: MediaStreamTrack) => {
      if (track.kind === 'audio') {
        this.startAudioPipeline(track);
      }
    });

    await audioPc.setRemoteDescription({ type: 'offer', sdp: offer });
    const answer = await audioPc.createAnswer();
    await audioPc.setLocalDescription(answer);
    return answer.sdp!;
  }

  private startAudioPipeline(track: any) {
    const platform = os.platform();
    const audioFfmpeg = ffmpeg()
      .input(track)
      .inputFormat('rtp');

    if (platform === 'win32') {
      audioFfmpeg
        .outputFormat('dshow')
        .audioCodec('pcm_s16le')
        .output('audio=Virtual Cable');
    } else if (platform === 'darwin') {
      audioFfmpeg
        .outputFormat('avfoundation')
        .audioCodec('pcm_s16le')
        .output(':TetherCam Audio');
    } else {
      audioFfmpeg
        .outputFormat('pulse')
        .audioCodec('pcm_s16le')
        .output('TetherCam_Audio');
    }

    audioFfmpeg
      .on('start', () => console.log('[FFmpeg Audio] Started virtual microphone'))
      .on('error', (err: Error) => console.error('[FFmpeg Audio] Error:', err.message))
      .run();
  }

  stop() {
    this.ffmpegProcess?.kill();
    this.pc?.close();
  }
}
