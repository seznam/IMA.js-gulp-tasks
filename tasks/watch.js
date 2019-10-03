const gulp = require('gulp');
const cache = require('gulp-cached');
const color = require('ansi-colors');
const log = require('fancy-log');
const remember = require('gulp-remember');
const watch = require('gulp-watch');
const path = require('path');
const net = require('net');
const fs = require('fs');
const WebSocket = require('ws');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

const sharedState = require('../gulpState.js');

const dgram = require('dgram');
const notifyServer = dgram.createSocket('udp4');
let notifyServerMessageTimeout = null;
let notifyServerJobQueue = [];

const chokidar = require('chokidar');
const WsServer = require('../lib/wsserver');

const HR_SENTINEL_NAME = 'watch/hot-reload';

exports.__requiresConfig = true;

exports.default = gulpConfig => {
  const {
    files,
    occupiedPorts,
    notifyServerConfig,
    wsServerConfig,
    hotReloadConfig
  } = gulpConfig;

  function watchTask() {
    let hotReloadedCacheKeys = [];

    function runGulpTaskOnChange(files, task) {
      watch(files, () => gulp.series(task)());
    }

    runGulpTaskOnChange(files.app.watch, 'app:build');
    runGulpTaskOnChange(files.vendor.watch, 'vendor:build');
    runGulpTaskOnChange(files.less.watch, 'less:build');
    runGulpTaskOnChange(files.server.watch, 'server:build');
    runGulpTaskOnChange(files.locale.watch, 'locale:build');
    runGulpTaskOnChange('./app/assets/static/**/*', 'copy:appStatic');

    // Websocket server
    if (wsServerConfig.enable) {
      if (!sharedState.wsServer) {
        log(`Staring wsServer on port: ${wsServerConfig.port}`);
        sharedState.wsServer = new WsServer({ port: wsServerConfig.port });
      }
    }

    // HotReload watchers
    if (hotReloadConfig.watch) {
      log(
        `Staring hotReload watchers for paths: ${hotReloadConfig.watch.join(
          ', '
        )}`
      );

      if (!sharedState.wsClient) {
        log(`Staring hotReload client on port ${wsServerConfig.port}`);
        sharedState.wsClient = new WebSocket(
          'ws://localhost:' + wsServerConfig.port
        );
      }
      const watcher = chokidar.watch(hotReloadConfig.watch, {
        persistent: true
      });
      watcher.on('change', hotReloadChangeBroadcast);
    }

    // HotReload callback
    function hotReloadChangeBroadcast(filename) {
      filename = path.normalize(filename).replace(/\\/g, '/');
      const hotReload = {
        sentinel: HR_SENTINEL_NAME,
        payload: {
          filename,
          contents: ''
        }
      };
      log(`hotReload: resource updated '${color.cyan(filename)}'`);

      hotReload.payload.contents = fs.readFileSync(filename, 'utf8');

      if (sharedState.wsClient) {
        sharedState.wsClient.send(JSON.stringify(hotReload));
      }
    }

    // Notification server
    if (notifyServerConfig.enable) {
      notifyServer.bind({
        address: notifyServerConfig.server,
        port: notifyServerConfig.port,
        exclusive: true
      });

      notifyServer.on('listening', () => {
        log(
          `Notification server listening on ${notifyServerConfig.server}:${
            notifyServerConfig.port
          } for messages [ ${Object.keys(notifyServerConfig.messageJobs)} ]`
        );
      });

      notifyServer.on('message', message => {
        const changedSubject = message.toString();
        Object.keys(notifyServerConfig.messageJobs).map(testRegexp => {
          const test = new RegExp(testRegexp, 'i');
          if (test.test(changedSubject)) {
            clearTimeout(notifyServerMessageTimeout);
            log(
              `Notify message [ '${color.cyan(
                changedSubject
              )}' ] queueing jobs:`,
              notifyServerConfig.messageJobs[testRegexp]
            );
            notifyServerJobQueue = notifyServerJobQueue.concat(
              notifyServerConfig.messageJobs[testRegexp].filter(job => {
                return !notifyServerJobQueue.includes(job);
              })
            );
            notifyServerMessageTimeout = setTimeout(() => {
              log(
                `Starting queued jobs: ${color.cyan(
                  notifyServerJobQueue.join(',')
                )}`
              );
              gulp.parallel(notifyServerJobQueue)();
              notifyServerJobQueue = [];
            }, notifyServerConfig.jobRunTimeout);
          }
        });
      });
    }

    gulp
      .watch([
        './ima/**/*.js',
        './app/**/*.{js,jsx}',
        './build/static/js/locale/*.js'
      ])
      .on('all', (event, filePath) => {
        sharedState.watchEvent = { path: filePath };
        let absoluteFilePath = path.resolve('.', filePath);

        let cacheKey = absoluteFilePath.toLowerCase().replace('.jsx', '.js');
        hotReloadedCacheKeys.push(cacheKey);

        if (event === 'unlink') {
          if (cache.caches['Es6ToEs5:server:app'][absoluteFilePath]) {
            delete cache.caches['Es6ToEs5:server:app'][absoluteFilePath];
            remember.forget(
              'Es6ToEs5:server:app',
              absoluteFilePath.replace('.jsx', '.js')
            );
          }
        }
      });
  }

  function checkAndReleasePorts() {
    const occupants = Object.keys(occupiedPorts);

    log(`Releasing ports occupied by ${occupants.join(', ')}`);

    return Promise.all(
      occupants.map(occupant => {
        const port = occupiedPorts[occupant];

        return isPortOccupied(port)
          .then(occupied => {
            if (!occupied) {
              return;
            }

            log(`Releasing port occupied by ${occupant}.`);

            const command =
              process.platform === 'win32'
                ? `Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port}).OwningProcess -Force`
                : `lsof -i:${port} | grep LISTEN | awk '{print $2}' | xargs kill -9`;

            return exec(command).catch(() => null);
          })
          .catch(error => {
            log(error);
            throw Error(`Unable to determine if port ${port} is occupied.`);
          });
      })
    );
  }

  function isPortOccupied(port) {
    return new Promise((resolve, reject) => {
      const tester = net.createServer();

      tester.once('error', error => {
        if (error.code !== 'EADDRINUSE') {
          return reject(error);
        }
        resolve(true);
      });

      tester.once('listening', () => {
        tester.once('close', () => resolve(false)).close();
      });

      tester.listen(port);
    });
  }

  return {
    watch: watchTask,
    'watch:releasePorts': checkAndReleasePorts
  };
};
