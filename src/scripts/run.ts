import { InnertubeSupportService } from '../lib/innertube/Service';

const service = new InnertubeSupportService();

process.on('SIGTERM', () => {
  console.log('Received SIGTERM');
  void (async () => {
    try {
      await service.stop();
    } finally {
      process.exit(0);
    }
  })();
});

try {
  void (async () => {
    const status = await service.start();
    console.log(`result: ${JSON.stringify(status)}`);
  })();
} catch (error) {
  console.log(
    `result: ${JSON.stringify({
      error: error instanceof Error ? error.message : String(error)
    })}`
  );
}
