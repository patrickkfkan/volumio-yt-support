import Innertube, { Platform } from 'volumio-youtubei.js';
import {
  type SpawnedInnertubeSupportService,
  spawnInnertubeSupportService
} from './Spawn';
import { getActiveAccountDatasyncIdToken } from './Utils';
import { type EvalFnResult, type PotFnResult } from './Server';
import { DefaultLogger, type Logger } from '../utils/Logger';
import { type PoTokenData } from './PoToken';

interface SessionIdentifier {
  type: 'visitorData' | 'datasyncIdToken';
  value: string;
  pageId?: string;
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

const PLAYER_ID = 'a944b11f';

export class InnertubeWrapper {
  #account?: AccountConfig = undefined;
  #locale: Locale = {};
  #service: SpawnedInnertubeSupportService | null = null;
  #sessionIdentifer: SessionIdentifier | null = null;
  #sessionPoToken: Promise<PoTokenData | null> | null = null;
  #poTokenRefreshTimer: NodeJS.Timeout | null = null;
  #logger: Logger;
  #disposed = false;
  protected innertube: Innertube | null = null;

  static async create(params?: {
    jsRuntime?: 'node' | 'deno';
    account?: AccountConfig;
    locale?: Locale;
    logger?: Logger;
  }) {
    const instance = new InnertubeWrapper();
    instance.#account = params?.account;
    instance.#locale = params?.locale || {};
    instance.#logger = params?.logger || new DefaultLogger();
    await instance.#init(params);
    return instance;
  }

  async #init(params?: { jsRuntime?: 'node' | 'deno' }) {
    // 1. Create Innertube instance
    const innertube = (this.innertube = await Innertube.create({
      cookie: this.#account?.cookie,
      player_id: PLAYER_ID
    }));
    this.#applyLocale();

    // 2. Get attestationChallenge (for bgutils) and spawn server with it
    const challengeResponse = await innertube.getAttestationChallenge(
      'ENGAGEMENT_TYPE_UNBOUND'
    );
    const service = (this.#service = await spawnInnertubeSupportService({
      jsRuntime: params?.jsRuntime,
      challengeResponse,
      callbacks: {
        onStdOut: (data) => {
          this.#logger.info(`Innertube support service: ${data.toString()}`);
        },
        onStdErr: (data) => {
          this.#logger.error(`Innertube support service: ${data.toString()}`);
        },
        onStop: () => {
          this.#logger.info(`Innertube support service: Stopped`);
          this.#service = null;
        }
      }
    }));
    if (service.status === 'started') {
      this.#logger.info(
        `Innertube support service running at http://${service.server.address}:${service.server.port}`
      );
    } else {
      throw Error(`Failed to start Innertube support service`);
    }
    Platform.shim.eval = (data, env) => this.#eval(data, env);

    // 3. Generate session PO token
    this.#sessionIdentifer = await this.#getSessionIdentifier(innertube);
    await this.getSessionPoToken();
  }

  getSessionPoToken() {
    return this.#doGetSessionPoToken();
  }

  async #doGetSessionPoToken(isRefresh = false): Promise<PoTokenData | null> {
    if (!this.#sessionPoToken || isRefresh) {
      this.#clearPoTokenRefreshTimer();
      if (isRefresh) {
        this.#logger.info('Refresh session PO token');
      }
      this.#sessionPoToken = this.#generateSessionPoToken();
      const pot = await this.#sessionPoToken;
      if (pot) {
        const { ttl, refreshThreshold = 100 } = pot;
        if (ttl) {
          let timeout = ttl - refreshThreshold;
          if (timeout < 0) {
            timeout = 120;
          }
          this.#logger.info(
            `Going to refresh session PO token in ${timeout} seconds`
          );
          this.#poTokenRefreshTimer = setTimeout(() => {
            this.#sessionPoToken = this.#doGetSessionPoToken(true);
          }, timeout * 1000);
        }
      }
    }
    return this.#sessionPoToken;
  }

  async generatePoToken(identifier: string): Promise<PotFnResult> {
    this.#assertReady();
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
    this.#assertReady();
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

  async #generateSessionPoToken(): Promise<PoTokenData | null> {
    const identifier = this.#sessionIdentifer;
    if (identifier) {
      const poTokenResult = await this.generatePoToken(identifier.value);
      this.#logger.info(
        `Obtained session PO token using ${identifier.type} (expires in ${poTokenResult.ttl} seconds)`
      );
      return poTokenResult;
    }
    this.#logger.warn('No session PO token: SessionIdentifier unavailable');
    return null;
  }

  async #getSessionIdentifier(
    innertube: Innertube
  ): Promise<SessionIdentifier | null> {
    const visitorData = innertube.session.context.client.visitorData;
    let identifier: SessionIdentifier | null = null;
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
            'SessionIdentifier: signed in but could not get datasyncIdToken - will return visitorData instead'
          );
        }
      }
    }
    if (!identifier && visitorData) {
      identifier = {
        type: 'visitorData',
        value: visitorData
      };
    }
    if (!identifier) {
      this.#logger.warn('SessionIdentifier: none found');
      return null;
    }
    return identifier;
  }

  getInnertube() {
    if (this.#assertReady()) {
      return this.innertube;
    }
    return undefined as never;
  }

  async dispose() {
    if (this.#disposed) {
      return;
    }
    this.#clearPoTokenRefreshTimer();
    this.#disposed = true;
    this.#sessionIdentifer = null;
    this.#sessionPoToken = null;
    this.innertube = null;
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
    if (!this.innertube) {
      return;
    }
    if (this.#locale.region) {
      this.innertube.session.context.client.gl = this.#locale.region;
    }
    if (this.#locale.language) {
      this.innertube.session.context.client.hl = this.#locale.language;
    }
  }

  setLocale(locale: Locale) {
    if (!this.innertube) {
      return;
    }
    this.#locale = locale;
    this.#applyLocale();
  }

  #assertReady(): this is this & { innertube: Innertube } {
    if (!this.innertube) {
      throw Error('Innertube not initialized');
    }
    if (this.#disposed) {
      throw Error('Innertube instance already disposed');
    }
    return true;
  }

  get serviceRuntime() {
    return this.#service ? this.#service.runtime : undefined;
  }
}
