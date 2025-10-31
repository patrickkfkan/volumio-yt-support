import EventEmitter from 'events';
import { DefaultLogger, type Logger } from '../utils/Logger';

export interface QueueItem {
  service: string;
  uri: string;
  albumart?: string;
  artist?: string;
  album?: string;
  name: string;
  title: string;
  duration?: number;
  samplerate?: string;
}

export interface LastPlaybackInfo {
  track: QueueItem;
  position: number;
}

export interface AutoplayManagerConfig {
  serviceName: string;
  stateMachine: any;
  volumioCoreCommand: any;
  mpdPlugin: any;
  getAutoplayItems: (
    lastPlaybackInfo: LastPlaybackInfo
  ) => Promise<QueueItem[]>;
  getConfigValue: (key: 'autoplay' | 'autoplayClearQueue') => boolean;
  logger?: Logger;
}

export type AutoplayManagerEvent = 'queued';
export type AutoplayManagerEventPayload<E extends AutoplayManagerEvent> =
  E extends 'queued' ? { items: QueueItem[] } : never;

interface MpdState {
  status: 'play' | 'stop' | 'pause';
  seek: number;
  uri: string;
}

/**
 * Autoplay:
 * Two listeners involved:
 * 1. volumioStateListener: captures 'volumioPushState' events.
 *    - On 'play' event of YT track, stores the track being played in `lastPlaybackInfo`
 *      and ensures mpdStateListener is added.
 *    - If on 'play' event of track povided by a different service, clear `lastPlaybackInfo` and
 *      ensure mpdStateListener is removed,
 * 2. mpdStateListener: captures MPD's system-player event.
 *    - On 'stop' event, check if the track that stopped playing (`lastPlaybackInfo`) is last item
 *      in queue. If so, fetch items for autoplay.
 *    - If `lastPlaybackInfo` is null, that means the track that stopped playing is not provided by
 *      the plugin. Nothing is to be done in this case.
 *
 * In theory, volumioStateListener can be used to listen for 'stop' events as well, so
 * mpdStateListener is not needed. In practice, it is difficult to process the events it emits:
 * - multiple events with the same payload are emitted for no reason;
 * - when moving to the next track in queue, a 'stop' event is emitted for the next track
 *   before the 'play' event.
 *
 * It is simpler and more predictable to just use volumioStateListener to capture the currently-played
 * track, and mpdStateListener to capture moment when playback stops.
 */

export class AutoplayManager extends EventEmitter {
  #config: AutoplayManagerConfig;
  #logger: Logger;
  #volumioStateListener: ((state: any) => void) | null;
  #mpdStateListener: (() => void) | null;
  #lastPlaybackInfo: LastPlaybackInfo | null;

  constructor(config: AutoplayManagerConfig) {
    super();
    this.#config = config;
    this.#mpdStateListener = null;
    this.#volumioStateListener = null;
    this.#lastPlaybackInfo = null;
    this.#logger = config.logger || new DefaultLogger();
  }

  enable() {
    this.#addVolumioStateListener();
    this.#logger.info('(AutoplayManager) Enabled');
  }

  disable() {
    this.#removeMpdStateListener();
    this.#removeVolumioStateListener();
    this.#logger.info('(AutoplayManager) Disabled');
  }

  #addVolumioStateListener() {
    if (!this.#volumioStateListener) {
      this.#volumioStateListener = (state: any) => {
        if (state.status === 'play') {
          if (state.service === this.#config.serviceName) {
            this.#lastPlaybackInfo = {
              track: state,
              position: state.position
            };
            // Volumio state indicates playback of YT track.
            // Ensure we listen for changes in MPD state
            this.#addMpdStateListener();
          } else {
            // Different service - autoplay doesn't apply
            this.#removeMpdStateListener();
            this.#lastPlaybackInfo = null;
            return;
          }
        }
      };
      this.#config.volumioCoreCommand?.addCallback(
        'volumioPushState',
        this.#volumioStateListener
      );
      this.#logger.info('(AutoplayManager) Added volumioStateListener');
    }
  }

  #removeVolumioStateListener() {
    if (this.#volumioStateListener) {
      const listeners =
        this.#config.volumioCoreCommand?.callbacks?.['volumioPushState'] || [];
      const index = listeners.indexOf(this.#volumioStateListener);
      if (index >= 0) {
        this.#config.volumioCoreCommand.callbacks['volumioPushState'].splice(
          index,
          1
        );
      }
      this.#volumioStateListener = null;
      this.#logger.info('(AutoplayManager) Removed volumioStateListener');
    }
  }

  #addMpdStateListener() {
    if (!this.#mpdStateListener) {
      this.#mpdStateListener = () => {
        this.#config.mpdPlugin.getState().then((state: MpdState) => {
          if (state.status === 'stop') {
            this.#logger.info(`(AutoplayManager) MPD 'stop' event received`);
            void this.#handleAutoplay();
            this.#removeMpdStateListener();
          }
        });
      };
      this.#config.mpdPlugin.clientMpd.on(
        'system-player',
        this.#mpdStateListener
      );
      this.#logger.info(`(AutoplayManager) Added mpdStateListener`);
    }
  }

  #removeMpdStateListener() {
    if (this.#mpdStateListener) {
      this.#config.mpdPlugin.clientMpd.removeListener(
        'system-player',
        this.#mpdStateListener
      );
      this.#mpdStateListener = null;
      this.#logger.info('(AutoplayManager) Removed mpdStateListener');
    }
  }

  async #handleAutoplay() {
    this.#logger.info('(AutoplayManager) Check if autoplay needed');
    const stateMachine = this.#config.stateMachine;
    const state = stateMachine.getState();
    if (state.random || state.repeat || state.repeatSingle) {
      const q = {
        random: state.random,
        repeat: state.repeat,
        repeatSingle: state.repeatSingle
      };
      this.#logger.info(
        `(AutoplayManager) Autoplay not applicable to state: ${JSON.stringify(q)}`
      );
      return;
    }
    if (!this.#config.getConfigValue('autoplay') || !this.#lastPlaybackInfo) {
      this.#logger.info(
        `(AutoplayManager) Autoplay not configured or there is no previous played "${this.#config.serviceName}" track`
      );
      return;
    }
    const lastPlayedQueueIndex = this.#findLastPlayedTrackQueueIndex();
    if (lastPlayedQueueIndex < 0) {
      this.#logger.info(
        '(AutoplayManager) Could not find previous played track in queue'
      );
      return;
    }
    const isLastTrack =
      stateMachine.getQueue().length - 1 === lastPlayedQueueIndex;
    if (!isLastTrack) {
      this.#logger.info(
        '(AutoplayManager) Previous played track is not last in queue'
      );
      return;
    }

    this.#logger.info(
      '(AutoplayManager) Autoplay triggered - fetch items to add to the queue'
    );
    const items = await this.#config.getAutoplayItems(this.#lastPlaybackInfo);
    if (items.length > 0) {
      // Add items to queue and play
      const clearQueue = this.#config.getConfigValue('autoplayClearQueue');
      if (clearQueue) {
        stateMachine.clearQueue();
      }
      await new Promise<void>((resolve) => {
        stateMachine
          .addQueueItems(items)
          .then((result: { firstItemIndex: number }) => {
            stateMachine.play(result.firstItemIndex);
            resolve();
          });
      });
    }
    this.#logger.info(`(AutoplayManager) added ${items.length} items to queue`);
    this.emit('queued', { items });
  }

  #findLastPlayedTrackQueueIndex() {
    if (!this.#lastPlaybackInfo) {
      return -1;
    }

    const queue = this.#config.stateMachine.getQueue();
    const trackUri = this.#lastPlaybackInfo.track.uri;
    const endIndex = this.#lastPlaybackInfo.position;

    for (let i = endIndex; i >= 0; i--) {
      if (queue[i]?.uri === trackUri) {
        return i;
      }
    }

    return -1;
  }

  emit<E extends AutoplayManagerEvent>(
    eventName: E,
    args: AutoplayManagerEventPayload<E>
  ): boolean;
  emit(eventName: string | symbol, ...args: any[]): boolean {
    return super.emit(eventName, ...args);
  }

  on<E extends AutoplayManagerEvent>(
    eventName: E,
    listener: (args: AutoplayManagerEventPayload<E>) => void
  ): this;
  on(eventName: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(eventName, listener);
  }

  once<E extends AutoplayManagerEvent>(
    eventName: E,
    listener: (args: AutoplayManagerEventPayload<E>) => void
  ): this;
  once(eventName: string | symbol, listener: (...args: any[]) => void): this {
    return super.once(eventName, listener);
  }

  off<E extends AutoplayManagerEvent>(
    eventName: E,
    listener: (args: AutoplayManagerEventPayload<E>) => void
  ): this;
  off(eventName: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(eventName, listener);
  }
}
