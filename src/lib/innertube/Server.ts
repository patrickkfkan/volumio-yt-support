import express from 'express';
import { type Server } from 'http';
import { type AddressInfo } from 'net';
import { type Platform } from 'volumio-youtubei.js';

export interface PotFnResult {
  poToken: string;
  ttl: number;
  refreshThreshold: number;
}

export type EvalFnResult = ReturnType<typeof Platform.shim.eval>;

export interface InnertubeSupportServerConfig {
  potFn: (identifier: string) => Promise<PotFnResult>;
  evalFn: typeof Platform.shim.eval;
}

export class InnertubeSupportServer {
  #config: InnertubeSupportServerConfig;
  #server: Server | null;
  #status: 'started' | 'stopped';
  #startPromise: Promise<AddressInfo> | null;

  constructor(config: InnertubeSupportServerConfig) {
    this.#config = config;
    this.#server = null;
    this.#status = 'stopped';
    this.#startPromise = null;
  }

  async start() {
    if (!this.#startPromise) {
      this.#startPromise = new Promise((resolve, reject) => {
        const app = express();
        const server = app.listen(0, '127.0.0.1', (err) => {
          if (err) {
            this.#server = null;
            this.#startPromise = null;
            this.#status = 'stopped';
            return reject(err);
          }
          this.#server = server;
          this.#status = 'started';
          this.#setRoutes(app);
          resolve(server.address() as AddressInfo);
        });
      });
    }
    return this.#startPromise;
  }

  stop() {
    if (this.#status === 'stopped') {
      return;
    }
    return new Promise<void>((resolve, reject) => {
      if (this.#server) {
        this.#server.close((error) => {
          if (error) {
            return reject(error);
          }
          this.#startPromise = null;
          this.#server = null;
          this.#status = 'stopped';
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  #setRoutes(app: express.Express) {
    app.use(express.json());
    app.get('/pot', async (req, res) => {
      const identifier = req.query.identifier;
      if (!identifier) {
        return res.status(500).json({
          error: 'Request is missing param "identifier"'
        });
      }
      res.status(200).json(await this.#config.potFn(identifier as string));
    });

    app.post('/eval', async (req, res) => {
      const { data, env } = req.body;
      if (!data || !env) {
        return res.status(500).json({
          error: 'Request body is missing "data" or "env"'
        });
      }
      const result = await this.#config.evalFn(data, env);
      res.status(200).json(result);
    });
  }

  get status() {
    return this.#status;
  }
}
