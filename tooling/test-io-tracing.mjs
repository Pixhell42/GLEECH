// Test-only tracing: paths are reduced to file names; file contents are never recorded.
export async function installTestIOTracing(app) {
  await app.evaluate(({ BrowserWindow }) => {
    // Exercise native windows on the disposable hosted desktop. Hidden smoke
    // windows have stalled independently of UI visibility/background throttling.
    // Keep local tests hidden and leave production launch behavior unchanged.
    if (process.env.GITHUB_ACTIONS === 'true') {
      for (const window of BrowserWindow.getAllWindows()) window.showInactive();
    }
    const fs = process.getBuiltinModule('node:fs/promises');
    const { Worker } = process.getBuiltinModule('node:worker_threads');
    const jobs = [];
    globalThis.__gleechTestWorkerJobs = jobs;
    const post = Worker.prototype.postMessage,
      emit = Worker.prototype.emit;
    Worker.prototype.postMessage = function (message, ...args) {
      if (typeof message?.id === 'number') {
        jobs.push({
          id: message.id,
          action: message.action,
          started: Date.now(),
          status: 'pending',
        });
        if (jobs.length > 100) jobs.shift();
      }
      return Reflect.apply(post, this, [message, ...args]);
    };
    Worker.prototype.emit = function (event, ...args) {
      if (event === 'message') {
        const record = jobs.find(
          (record) => record.id === args[0]?.id && record.status === 'pending',
        );
        if (record) {
          record.status = args[0].ok ? 'completed' : 'failed';
          record.elapsedMs = Date.now() - record.started;
        }
      }
      return Reflect.apply(emit, this, [event, ...args]);
    };
    const { basename } = process.getBuiltinModule('node:path');
    const records = [];
    globalThis.__gleechTestIO = records;
    const wrap = (object, name, fileName) => {
      const original = object[name];
      object[name] = function (...args) {
        const record = {
          operation: name,
          file: fileName ?? (typeof args[0] === 'string' ? basename(args[0]) : '(handle)'),
          started: Date.now(),
          status: 'pending',
        };
        records.push(record);
        if (records.length > 200) records.shift();
        const completed = (result) => {
          record.status = 'completed';
          record.elapsedMs = Date.now() - record.started;
          if (name === 'open') {
            for (const method of ['stat', 'readFile', 'close']) wrap(result, method, record.file);
          }
        };
        const failed = (error) => {
          record.status = 'failed';
          record.code = error.code;
          record.elapsedMs = Date.now() - record.started;
        };
        try {
          const promise = Reflect.apply(original, this, args);
          promise.then(completed, failed);
          return promise; // Preserve the original promise and its scheduling.
        } catch (error) {
          failed(error);
          throw error;
        }
      };
    };
    for (const method of ['open', 'readFile', 'writeFile', 'rename', 'unlink', 'mkdir'])
      wrap(fs, method);
  });
}
