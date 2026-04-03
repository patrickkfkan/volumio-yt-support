import { MPVService, VLCService } from 'volumio-ext-players';
import { getErrorMessage, type Logger } from '../utils/Logger';

export type I18nKey<P extends string> =
  | `${P}_STARTING_PLAYER`
  | `${P}_ERR_PLAYER_START`
  | `${P}_ERR_PLAYER_QUIT`
  | `${P}_PLAYER_CLOSED_UNEXPECTEDLY`;

export interface ExternalPlayerManagerConfig<P extends string> {
  serviceName: string;
  logger: Logger;
  stateMachine: any;
  volumioCoreCommand: any;
  mpdPlugin: any;
  i18n: {
    prefix: P;
    get: (key: I18nKey<P>, ...args: string[]) => string;
  };
  toast: (type: 'info' | 'warning' | 'error', message: string) => void;
}

export type ExternalPlayer = 'vlc' | 'mpv';

type PlayerMap = Record<ExternalPlayer, MPVService | VLCService | null>;

export class ExternalPlayerManager<P extends string> {
  #serviceName: string;
  #logger: Logger;
  #toast: ExternalPlayerManagerConfig<P>['toast'];
  #i18nPrefix: ExternalPlayerManagerConfig<P>['i18n']['prefix'];
  #getI18n: ExternalPlayerManagerConfig<P>['i18n']['get'];
  #config: ExternalPlayerManagerConfig<P>;

  #players: PlayerMap = {
    vlc: null,
    mpv: null
  };

  constructor(config: ExternalPlayerManagerConfig<P>) {
    this.#serviceName = config.serviceName;
    this.#logger = config.logger;
    this.#toast = config.toast;
    this.#i18nPrefix = config.i18n.prefix;
    this.#getI18n = config.i18n.get;
    this.#config = config;
  }

  async get(player: ExternalPlayer) {
    if (this.#players[player]) {
      return this.#players[player];
    }
    let startPromise;
    switch (player) {
      case 'mpv':
        startPromise = this.#startMpv();
        break;
      case 'vlc':
        startPromise = this.#startVLC();
        break;
    }
    this.#logger.info(`[ytmusic] Going to start ${player} for playback`);
    const playerName = this.#getPlayerName(player);
    try {
      const p = await startPromise;
      p.once('close', (code) => {
        if (code && code !== 0) {
          this.#toast(
            'warning',
            this.#getI18n(
              `${this.#i18nPrefix}_PLAYER_CLOSED_UNEXPECTEDLY`,
              playerName
            )
          );
        }
        this.#logger.info(`[ytmusic] ${player} process closed`);
        this.#players[player] = null;
      });
      this.#players[player] = p;
      return p;
    } catch (error) {
      this.#toast(
        'error',
        getErrorMessage(
          this.#getI18n(`${this.#i18nPrefix}_ERR_PLAYER_START`, playerName),
          error
        )
      );
      return null;
    }
  }

  async #startMpv() {
    this.#toast(
      'info',
      this.#getI18n(`${this.#i18nPrefix}_STARTING_PLAYER`, 'mpv')
    );
    try {
      const mpv = new MPVService({
        serviceName: this.#serviceName,
        logger: this.#logger,
        volumio: {
          commandRouter: this.#config.volumioCoreCommand,
          mpdPlugin: this.#config.mpdPlugin,
          statemachine: this.#config.stateMachine
        }
      });
      await mpv.start();
      return mpv;
    } catch (error) {
      throw Error(
        getErrorMessage(
          this.#getI18n(`${this.#i18nPrefix}_ERR_PLAYER_START`, 'mpv'),
          error
        ),
        { cause: error }
      );
    }
  }

  async #startVLC() {
    this.#toast(
      'info',
      this.#getI18n(`${this.#i18nPrefix}_STARTING_PLAYER`, 'VLC')
    );
    try {
      const vlc = new VLCService({
        serviceName: this.#serviceName,
        logger: this.#logger,
        volumio: {
          commandRouter: this.#config.volumioCoreCommand,
          mpdPlugin: this.#config.mpdPlugin,
          statemachine: this.#config.stateMachine
        }
      });
      await vlc.start();
      return vlc;
    } catch (error) {
      throw Error(
        getErrorMessage(
          this.#getI18n(`${this.#i18nPrefix}_ERR_PLAYER_START`, 'VLC'),
          error
        ),
        { cause: error }
      );
    }
  }

  stop(player: ExternalPlayer) {
    const p = this.#players[player];
    if (p && p.isActive()) {
      return p.stop();
    }
  }

  getActive() {
    return Object.values(this.#players).find((p) => p && p.isActive()) ?? null;
  }

  async quit(player: ExternalPlayer) {
    const p = this.#players[player];
    if (p) {
      try {
        await p.quit();
      } catch (error) {
        this.#toast(
          'error',
          this.#getI18n(
            `${this.#i18nPrefix}_ERR_PLAYER_QUIT`,
            this.#getPlayerName(player),
            getErrorMessage('', error, false)
          )
        );
      } finally {
        this.#players[player] = null;
      }
    }
  }

  quitAll() {
    return Promise.all(
      Object.keys(this.#players).map((player) =>
        this.quit(player as ExternalPlayer)
      )
    );
  }

  #getPlayerName(player: ExternalPlayer) {
    switch (player) {
      case 'mpv':
        return 'mpv';
      case 'vlc':
        return 'VLC';
    }
  }
}
