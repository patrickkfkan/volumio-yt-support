import { InnertubeSupportServer } from './Server';
import { createPoTokenMinter, type PoTokenMinterResult } from './PoToken';
import { type Platform } from 'volumio-youtubei.js';

export type InnertubeSupportServiceStatus =
  | {
      status: 'stopped';
    }
  | {
      status: 'started';
      server: {
        address: string;
        port: number;
      };
    };

function evalFnImpl(...args: Parameters<typeof Platform.shim.eval>) {
  const [data, env] = args;
  const properties = [];

  if (env.n) {
    properties.push(`n: exportedVars.nFunction("${env.n}")`);
  }

  if (env.sig) {
    properties.push(`sig: exportedVars.sigFunction("${env.sig}")`);
  }

  const code = `${data.output}\nreturn { ${properties.join(', ')} }`;

  // eslint-disable-next-line  @typescript-eslint/no-implied-eval
  return Function(code)();
}

export class InnertubeSupportService {
  #status: InnertubeSupportServiceStatus;
  #server: InnertubeSupportServer | null;
  #startPromise: Promise<InnertubeSupportServiceStatus> | null;
  #minterPromise: Promise<PoTokenMinterResult> | null;
  #refreshMinterTimer: NodeJS.Timeout | null;

  constructor() {
    this.#server = null;
    this.#startPromise = null;
    this.#minterPromise = null;
    this.#refreshMinterTimer = null;
    this.#status = {
      status: 'stopped'
    };
  }

  async #getMinter(forceCreate = false) {
    if (!this.#minterPromise || forceCreate) {
      this.#minterPromise = this.#createMinter();
    }
    return this.#minterPromise;
  }

  async #createMinter() {
    this.#clearRefreshMinterTimer();
    const minterResult = await createPoTokenMinter();
    const { ttl, refreshThreshold = 100 } = minterResult;

    // Refresh minter earlier than what refreshThreshold suggests,
    // so requests coming in will use the new minter.
    const timeout = ttl - refreshThreshold - 100;
    this.#refreshMinterTimer = setTimeout(() => {
      this.#minterPromise = this.#createMinter();
    }, timeout * 1000);

    return minterResult;
  }

  #clearRefreshMinterTimer() {
    if (this.#refreshMinterTimer) {
      clearTimeout(this.#refreshMinterTimer);
    }
    this.#refreshMinterTimer = null;
  }

  async start() {
    if (this.#startPromise) {
      return this.#startPromise;
    }
    this.#startPromise = new Promise<InnertubeSupportServiceStatus>(
      (resolve, reject) => {
        void (async () => {
          try {
            this.#server = new InnertubeSupportServer({
              potFn: async (identifier) => {
                const { minter, ttl, refreshThreshold, created } =
                  await this.#getMinter();
                const poToken = await minter.mintAsWebsafeString(identifier);
                const adjustedTTL = Math.floor(
                  (ttl * 1000 + created - Date.now()) / 1000
                );
                return {
                  poToken,
                  ttl: adjustedTTL,
                  refreshThreshold
                };
              },
              evalFn: (data, env) => evalFnImpl(data, env)
            });
            const status = await this.#server.start();
            resolve({
              status: 'started',
              server: {
                address: status.address,
                port: status.port
              }
            });
          } catch (err) {
            this.#startPromise = null;
            this.#server = null;
            this.#status = {
              status: 'stopped'
            };
            reject(err instanceof Error ? err : Error(String(err)));
          }
        })();
      }
    );
    return this.#startPromise;
  }

  async stop() {
    if (this.#status.status === 'stopped') {
      return;
    }
    await this.#server?.stop()?.finally(() => {
      this.#startPromise = null;
      this.#server = null;
      this.#status = {
        status: 'stopped'
      };
    });
  }

  get status() {
    return this.#status;
  }
}
