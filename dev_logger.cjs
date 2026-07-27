const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// 1. Define TWO separate log files
const logFilePath = path.join(__dirname, 'local-logs.txt');
const errorFilePath = path.join(__dirname, 'local-errors.txt');

// 2. Create TWO separate write streams
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
const errorStream = fs.createWriteStream(errorFilePath, { flags: 'a' });

console.log(`Normal Logs → ${logFilePath}`);
console.log(`Errors      → ${errorFilePath}`);
console.log('---------------------------------------------------');

const wrangler = spawn('wrangler', ['dev', '--local'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true 
});

// 3. Handle standard output (Pino info/debug logs, Wrangler startup)
wrangler.stdout.on('data', (data) => {
  const text = data.toString();
  process.stdout.write(text); // Print to console
  logStream.write(text);      // Save ONLY to the normal log file
});

// 4. Handle standard error (Crashes, Wrangler warnings, Node errors)
wrangler.stderr.on('data', (data) => {
  const text = data.toString();
  process.stderr.write(text); // Print to console in red (usually)
  errorStream.write(text);    // Save ONLY to the error log file
});

// 5. Clean up BOTH streams when Wrangler stops
wrangler.on('close', (code) => {
  logStream.end();
  errorStream.end(); // Close the error stream too!
  console.log('\n---------------------------------------------------');
  console.log(`Wrangler stopped with exit code ${code}`);
  process.exit(code);
});

// Handle manual termination (Ctrl+C)
process.on('SIGINT', () => {
  wrangler.kill('SIGINT');
});