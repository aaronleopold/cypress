const Sqrl = require('squirrelly')
const { fs } = require('./util/fs')

const cache = {}

module.exports = {
  cache,

  render (filePath, options, cb) {
    const cachedFn = cache[filePath]

    // if we already have a cachedFn function
    if (cachedFn) {
      // just return it and move in
      return cb(null, cachedFn(options, Sqrl))
    }

    // else go read it off the filesystem
    return fs
    .readFileAsync(filePath, 'utf8')
    .then((str) => {
      // and cache the Sqrl compiled template fn
      const compiledFn = cache[filePath] = Sqrl.compile(str)

      return compiledFn(options, Sqrl.defaultConfig)
    })
    .asCallback(cb)
  },
}
