import { config } from './config.js';
import { createApp } from './app.js';
import { requireFfmpeg } from './ffmpeg/locate.js';
import { ensureTmpDir, startTmpSweeper } from './tmp.js';

// Health check first, before anything else is set up. If ffmpeg is missing there
// is no useful version of Scrub to start, and finding that out at Run instead of
// at boot costs the user an hour.
const tools = requireFfmpeg();

await ensureTmpDir();
startTmpSweeper();

const app = createApp(tools);

app.listen(config.port, config.host, () => {
  process.stdout.write(
    [
      `  scrub server   http://${config.host}:${String(config.port)}`,
      `  ffmpeg         ${tools.ffmpeg.version}`,
      `  ffprobe        ${tools.ffprobe.version}`,
      `  working dir    ${config.tmpDir}`,
      '',
    ].join('\n'),
  );
});
