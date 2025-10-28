import Innertube, { Platform } from 'volumio-youtubei.js';
import {
  type SpawnedInnertubeSupportService,
  spawnInnertubeSupportService
} from './Spawn';
import {
  DefaultLogger,
  getActiveAccountDatasyncIdToken,
  type Logger
} from './Utils';
import { type EvalFnResult, type PotFnResult } from './Server';

interface POToken {
  params: {
    visitorData?: string;
    identifier: {
      type: 'visitorData' | 'datasyncIdToken';
      value: string;
      pageId?: string;
    };
  };
  value: string;
  ttl?: number;
  refreshThreshold?: number;
}

export type AccountConfig =
  | {
      cookie: string;
      activeChannelHandle?: string;
    }
  | {
      cookie?: undefined;
    };

export interface Locale {
  region?: string;
  language?: string;
}

export class InnertubeWrapper {
  #account?: AccountConfig = undefined;
  #locale: Locale = {};
  #innertubePromise: Promise<Innertube> | null = null;
  #service: SpawnedInnertubeSupportService | null = null;
  #innertube: Innertube | null = null;
  #lastSessionPoToken: POToken | null = null;
  #poTokenRefreshTimer: NodeJS.Timeout | null = null;
  #logger: Logger;
  #disposed = false;

  static async create(params?: {
    account?: AccountConfig;
    locale?: Locale;
    logger?: Logger;
  }) {
    const instance = new InnertubeWrapper();
    instance.#account = params?.account;
    instance.#locale = params?.locale || {};
    const logger = (instance.#logger = params?.logger || new DefaultLogger());
    const service = (instance.#service = await spawnInnertubeSupportService({
      onStdOut: (data) => {
        logger.info(`Innertube support service: ${data.toString()}`);
      },
      onStdErr: (data) => {
        logger.error(`Innertube support service: ${data.toString()}`);
      },
      onStop: () => {
        logger.info(`Innertube support service: Stopped`);
        instance.#service = null;
      }
    }));
    if (service.status === 'started') {
      logger.info(
        `Innertube support service running at http://${service.server.address}:${service.server.port}`
      );
    } else {
      throw Error(`Failed to start Innertube support service`);
    }
    Platform.shim.eval = (data, env) => instance.#eval(data, env);
    await instance.#initInnertubePromise();
    return instance;
  }

  async generatePoToken(identifier: string): Promise<PotFnResult> {
    this.#checkDisposed();
    if (!this.#service || this.#service.status === 'stopped') {
      throw Error('Innertube support service not started');
    }
    const url = new URL(
      `http://${this.#service.server.address}:${this.#service.server.port}/pot`
    );
    url.searchParams.set('identifier', identifier);
    return (await fetch(url)).json();
  }

  async #eval(
    ...args: Parameters<typeof Platform.shim.eval>
  ): Promise<EvalFnResult> {
    this.#checkDisposed();
    if (!this.#service || this.#service.status === 'stopped') {
      throw Error('Innertube support service not started');
    }
    const url = `http://${this.#service.server.address}:${this.#service.server.port}/eval`;
    const [data, env] = args;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data,
        env
      })
    });
    return await res.json();
  }

  async #generateSessionPoToken() {
    let identifier: POToken['params']['identifier'] | null = null;
    let visitorData;
    if (this.#lastSessionPoToken) {
      identifier = this.#lastSessionPoToken.params.identifier;
      visitorData = this.#lastSessionPoToken.params.visitorData;
    } else {
      const innertube =
        this.#innertube ||
        (await Innertube.create({
          cookie: this.#account?.cookie
        }));
      visitorData = innertube.session.context.client.visitorData;
      if (this.#account?.cookie) {
        const datasyncIdTokenResult = await getActiveAccountDatasyncIdToken(
          innertube,
          this.#logger,
          this.#account?.activeChannelHandle
        );
        if (datasyncIdTokenResult.hasActiveAccount) {
          const { datasyncIdToken, pageId } = datasyncIdTokenResult;
          if (datasyncIdToken) {
            identifier = {
              type: 'datasyncIdToken',
              value: datasyncIdToken,
              pageId
            };
          } else {
            this.#logger.warn(
              'Signed in but could not get datasyncIdToken for fetching session PO token - will use visitorData instead'
            );
          }
        }
      }
    }
    if (!identifier && visitorData) {
      identifier = {
        type: 'visitorData',
        value: visitorData
      };
    }
    if (identifier) {
      const poTokenResult = await this.generatePoToken(identifier.value);
      this.#logger.info(
        `Obtained session PO token using ${identifier.type} (expires in ${poTokenResult.ttl} seconds)`
      );
      return {
        params: {
          visitorData,
          identifier
        },
        value: poTokenResult.poToken,
        ttl: poTokenResult.ttl,
        refreshThreshold: poTokenResult.refreshThreshold
      };
    }
    return null;
  }

  getInnertube() {
    this.#checkDisposed();
    return this.#initInnertubePromise();
  }

  #initInnertubePromise() {
    if (!this.#innertubePromise) {
      this.#innertubePromise = this.#initInnertube();
    }
    return this.#innertubePromise;
  }

  async #initInnertube() {
    this.#clearPoTokenRefreshTimer();
    const sessionPot = await this.#generateSessionPoToken();
    this.#lastSessionPoToken = sessionPot;
    if (!sessionPot) {
      this.#innertube =
        this.#innertube ||
        (await Innertube.create({
          cookie: this.#account?.cookie
        }));
      this.#applyLocale();
      this.#logger.warn(
        'PO token was not used to create Innertube instance. Playback of YouTube content might fail.'
      );
      return this.#innertube;
    }
    this.#innertube = await Innertube.create({
      cookie: this.#account?.cookie,
      visitor_data: sessionPot.params.visitorData,
      on_behalf_of_user: sessionPot.params.identifier.pageId,
      po_token: sessionPot.value
    });
    this.#applyLocale();
    if (sessionPot) {
      const { ttl, refreshThreshold = 100 } = sessionPot;
      if (ttl) {
        let timeout = ttl - refreshThreshold;
        if (timeout < 0) {
          timeout = 120;
        }
        this.#logger.info(
          `Going to refresh session PO token in ${timeout} seconds`
        );
        this.#poTokenRefreshTimer = setTimeout(
          () => this.#refreshSessionPoToken(),
          timeout * 1000
        );
      }
    }
    return this.#innertube;
  }

  #refreshSessionPoToken() {
    this.#clearPoTokenRefreshTimer();
    this.#logger.info('Refresh session PO token');
    this.#innertubePromise = this.#initInnertube();
  }

  async dispose() {
    if (this.#disposed) {
      return;
    }
    this.#clearPoTokenRefreshTimer();
    this.#disposed = true;
    this.#innertubePromise = null;
    this.#lastSessionPoToken = null;
    this.#innertube = null;
    if (this.#service) {
      await this.#service.stop();
      this.#service = null;
    }
  }

  #clearPoTokenRefreshTimer() {
    if (this.#poTokenRefreshTimer) {
      clearTimeout(this.#poTokenRefreshTimer);
      this.#poTokenRefreshTimer = null;
    }
  }

  #applyLocale() {
    this.#checkDisposed();
    if (!this.#innertube) {
      return;
    }
    if (this.#locale.region) {
      this.#innertube.session.context.client.gl = this.#locale.region;
    }
    if (this.#locale.language) {
      this.#innertube.session.context.client.hl = this.#locale.language;
    }
  }

  setLocale(locale: Locale) {
    this.#checkDisposed();
    this.#locale = locale;
    this.#applyLocale();
  }

  #checkDisposed() {
    if (this.#disposed) {
      throw Error('Innertube instance already disposed');
    }
  }

  get serviceRuntime() {
    return this.#service ? this.#service.runtime : undefined;
  }
}
