
let gulp = require('gulp');
let cache = require('gulp-cached');
let flo = require('fb-flo');
let fs = require('fs');
let gutil = require('gulp-util');
let remember = require('gulp-remember');
let watch = require('gulp-watch');

let sharedState = require('../gulpState.js');

exports.__requiresConfig = true;

exports.default = (gulpConfig) => {
	let files = gulpConfig.files;

	function watchTask() {
		runOnChange(files.app.watch, 'app_build');
		runOnChange(files.ima.watch, 'ima_build');
		runOnChange(files.vendor.watch, 'vendor_build');
		runOnChange(files.less.watch, 'less');
		runOnChange(files.server.watch, 'server_build');
		runOnChange(files.locale.watch, 'locale_build');
		runOnChange('./app/assets/static/**/*', 'copy_appStatic');

		gulp.watch([
			'./ima/**/*.js',
			'./app/**/*.{js,jsx}',
			'./build/static/js/locale/*.js'
		]).on('change', (event) => {
			sharedState.watchEvent = event;

			if (event.type === 'deleted') {
				if (cache.caches['Es6ToEs5_app'][event.path]) {
					delete cache.caches['Es6ToEs5_app'][event.path];
					remember.forget('Es6ToEs5_app', event.path);
				}

				if (cache.caches['Es6ToEs5_ima'][event.path]) {
					delete cache.caches['Es6ToEs5_ima'][event.path];
					remember.forget('Es6ToEs5_ima', event.path);
				}
			}
		});

		flo(
			'./build/static/',
			{
				port: 5888,
				host: 'localhost',
				glob: [
					'**/*.css',
					'**/*.js'
				]
			},
			(filepath, callback) => {
				gutil.log(
					`Reloading 'public/${gutil.colors.cyan(filepath)}' with ` +
					'flo...'
				);

				let fileContents = fs.readFileSync(
					`./build/static/${filepath}`
				);
				callback({
					resourceURL: 'static/' + filepath,
					contents: fileContents.toString()
				});
			}
		);

		function runOnChange(files, tasks) {
			watch(files, () => gulp.start(tasks));
		}
	}

	return {
		watch: watchTask
	};
};
