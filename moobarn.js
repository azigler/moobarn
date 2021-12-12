const fs = require('fs')
const path = require('path')
const pidusage = require('pidusage')

class Moobarn extends require('events') {
  constructor ({
    loopIntervalHours = process.env.LOOP_INTERVAL_HOURS,
    defaultMooPort = process.env.DEFAULT_MOO_PORT || 7777,
    defaultBackupFinalScript = process.env.DEFAULT_BACKUP_FINAL_SCRIPT || '',
    defaultBackupIntervalHours = process.env.DEFAULT_BACKUP_INTERVAL_HOURS || 24,
    bridgeTelnetPort = process.env.BRIDGE_TELNET_PORT || 7988,
    bridgeWebsocketPort = process.env.BRIDGE_WEBSOCKET_PORT || 7989,
    webPort = process.env.WEB_PORT || 7987,
    webHost = process.env.WEB_HOST || 'localhost',
    webTlsCert = (process.env.WEB_TLS_CERT !== '') ? process.env.WEB_TLS_CERT : false,
    webTlsKey = (process.env.WEB_TLS_KEY !== '') ? process.env.WEB_TLS_KEY : false,
    webCookieUsername = process.env.WEB_COOKIE_USERNAME || 'moobarn',
    webCookiePassword = process.env.WEB_COOKIE_PASSWORD || 'moobarn-hapi-authentication-cookie',
    webCookieTtlDays = process.env.WEB_COOKIE_TTL_DAYS || 1,
    webLoginUsername = process.env.WEB_LOGIN_USERNAME || 'admin',
    webLoginPassword = process.env.WEB_LOGIN_PASSWORD || 'moobarn'
  } = {}) {
    super()

    this.on('start', async () => {
      this.startTime = new Date()
      if (this.FLAG === 'verbose') console.log(`[%] Starting moobarn @ ${this.startTime}`)
      this.serverLoop = setInterval(this.loop.bind(this), loopIntervalHours * 1000 * 60 * 60)

      this.controllers.forEach(controller => {
        if (!controller.init) return
        controller.init({
          server: this,
          loopIntervalHours,
          defaultMooPort,
          defaultBackupFinalScript,
          defaultBackupIntervalHours,
          bridgeTelnetPort,
          bridgeWebsocketPort,
          webPort,
          webHost,
          webTlsCert,
          webTlsKey,
          webCookieUsername,
          webCookiePassword,
          webCookieTtlDays,
          webLoginUsername,
          webLoginPassword
        })
      })
    })

    this.on('stop', () => {
      this.stopTime = new Date()
      console.log(`[%] Stopping moobarn @ ${this.stopTime}`)
      clearTimeout(this.serverLoop)
      this.serverLoop = false
    })

    this.mooAlreadyExistsError = (moo) => `ERROR: ${moo} moo already exists`
    this.notFoundError = (name, type) => `ERROR: ${name} ${type} not found`
    this.mooAlreadyStartedError = (moo) => `ERROR: ${moo} moo has already started`
    this.mooAlreadyStoppedError = (moo) => `ERROR: ${moo} moo has already stopped`
    this.backupFailedError = (moo) => `ERROR: back up failed for ${moo} moo`
    this.mooDisabledError = (moo) => `ERROR: ${moo} moo is disabled`
    this.notFoundForError = (notFound, forThing) => `[!] No ${notFound} found for ${forThing}... Setting default...`
    this.mooOnlineStatusMsg = (info) => `${info.pid ? `🟢 ONLINE @ ${info.mooArgs.ipv4 !== null ? info.mooArgs.ipv4 : ''} port ${info.mooArgs.port || this.controllers.get('process').defaultMooPort}` : '🔴 OFFLINE'}`

    this.controllers = new Map()
    this.barn = new Map()

    this.load()
  }

  loop () {
    this.emit('loop')
  }

  start (flag) {
    this.FLAG = flag
    this.load('barn')
    this.emit('start')
  }

  stop () {
    this.emit('stop')
  }

  mooExists (moo) {
    return fs.existsSync(path.join(__dirname, 'barn', moo))
  }

  dbExists (db) {
    return fs.existsSync(path.join(__dirname, 'dbs', db, `${db}.db`))
  }

  listAllMoos () {
    let longest = 0
    this.barn.forEach((value, key) => {
      if (key.length > longest) {
        longest = key.length
      }
    })

    console.log()
    this.barn.forEach((value, key) => {
      let padding = ''
      let goal = longest - key.length
      for (goal; goal > 0; goal--) {
        padding = padding + ' '
      }
      console.log(`${padding}${key} :: ${this.mooOnlineStatusMsg(value)}`)
    })
    console.log()
  }

  async printInfo (moo, list = false) {
    const result = this.barn.get(moo)
    if (result) {
      let usage = null
      if (result.pid !== null) {
        usage = await pidusage(result.pid)
      }

      console.log(`\n${moo} ${this.mooOnlineStatusMsg(result)}`)
      console.log(`   Disabled: ${result.disabled ? 'true' : 'false'}`)
      console.log(`   Isolated: ${result.insolated ? 'true' : 'false'}`)
      console.log(`        TLS: ${result.mooArgs.tls ? 'true' : 'false'}`)
      console.log(`        PID: ${!result.pid ? '(none)' : result.pid}`)
      if (usage) {
        console.log(`     Uptime: ${this.controllers.get('process').determineUptime(usage)}`)
        console.log(`     Memory: ${this.controllers.get('process').determineMemory(usage)}`)
        console.log(`        CPU: ${this.controllers.get('process').determineProcessor(usage)}`)
      }
      console.log(` Last start: ${!result.lastStart ? '(never)' : new Date(result.lastStart)}`)
      console.log(`Last backup: ${!result.lastBackup ? '(never)' : new Date(result.lastBackup)}\n`)
    } else {
      return console.log(this.notFoundError(moo, 'moo'))
    }
  }

  printAllInfo () {
    this.barn.forEach((value, key) => {
      this.printInfo(key, true)
    })
  }

  initMoo (moo, fromDb) {
    if (this.mooExists(moo)) {
      return console.log(this.mooAlreadyExistsError(moo))
    }

    if (!this.dbExists(fromDb)) {
      return console.log(this.notFoundError(fromDb, 'db'))
    }

    fs.mkdirSync(path.join(__dirname, 'barn', moo, 'backup'), { recursive: true }, (e) => {
      throw e
    })

    this.setMooInfo(moo)

    try {
      fs.copyFileSync(path.join(__dirname, 'dbs', fromDb, `${fromDb}.db`), path.join(__dirname, 'barn', moo, `${moo}.source.db`), fs.constants.COPYFILE_EXCL)
    } catch {
      console.log(this.mooAlreadyExistsError(moo))
    }

    console.log(`Successfully initialized ${moo} from ${fromDb}. You can now start it with 'node ./ start ${moo}'`)
  }

  loadMooInfo (moo) {
    try {
      return require(path.join(__dirname, 'barn', moo, 'info.json'))
    } catch {
      console.log(this.notFoundForError('info.json', `${moo} moo`))
      this.setMooInfo(moo)
    }
  }

  setMooInfo (moo, info, replace = false) {
    if (!info) {
      const initInfo = {
        backupFinalScript: null,
        backupIntervalHours: null,
        disabled: false,
        isolated: false,
        lastStart: 0,
        lastBackup: 0,
        mooArgs: {
          emergencyMode: null,
          scriptFile: null,
          scriptLine: null,
          logFile: null,
          clearLastMove: null,
          waifType: null,
          outbound: null,
          tls: null,
          ipv4: null,
          ipv6: null,
          port: 7777
        },
        name: moo,
        pid: null
      }

      return fs.writeFileSync(path.join(__dirname, 'barn', moo, 'info.json'), JSON.stringify(initInfo, null, '\t'), e => {
        throw e
      })
    }

    let data

    if (replace) {
      data = info
    } else {
      data = this.loadMooInfo(moo)
    }

    fs.writeFileSync(path.join(__dirname, 'barn', moo, 'info.json'), JSON.stringify({ ...data, ...info }, null, '\t'), e => {
      throw e
    })
  }

  load (type = null, dir = __dirname) {
    if (type === null) {
      this._loadType('controllers', dir)
    } else {
      this._loadType(type, dir)
    }
  }

  _loadType (type, dir) {
    if (fs.existsSync(path.join(dir, type))) {
      const files = fs.readdirSync(
        path.join(dir, type), e => {
          throw e
        }
      )

      if (files.length > 0) {
        for (let file of files) {
          if (file.endsWith('.js') || !file.includes('.')) {
            const filename = file = file.split('.')[0]

            let isDir = false
            try {
              isDir = fs.lstatSync(path.join(dir, type, file)).isDirectory()
            } catch {}

            file = `${file}${isDir ? '/' + 'index.js' : ''}`

            if (type === 'api') {
              if (this.FLAG === 'verbose') console.log(`[+] Loaded ${filename} <${type}> from ${path.join(dir, type)}`)
              const sourcePath = path.join(dir, type, file)
              this.controllers.get('web').api = [...this.controllers.get('web').api, require(sourcePath)]
              continue
            }

            if (type === 'barn') {
              this.barn.set(filename, this.loadMooInfo(filename))
              if (this.FLAG === 'verbose') console.log(`[*] Loaded ${filename} <moo> from ${path.join(dir, type)}`)
              continue
            } else {
              this[type].set(filename, require(
                path.join(dir, type, file)
              ))
            }

            if (type === 'controllers') {
              if (this.controllers.get(filename).init) {
                this.on('start', this.controllers.get(filename).start.bind(this.controllers.get(filename)))
                this.on('stop', this.controllers.get(filename).stop.bind(this.controllers.get(filename)))
              }

              if (this.controllers.get(filename).loop) {
                this.on('loop', this.controllers.get(filename).loop.bind(this.controllers.get(filename)))
              }
            }

            if (this.FLAG === 'verbose') console.log(`[+] Loaded ${filename} <${type.substr(0, type.length - 1)}> from ${path.join(dir, type)}`)
          }
        }
      }
    } else {
      if (this.FLAG === 'verbose') console.log(`[?] No ${type} found in ${dir}/${type}`)
    }
  }
}

module.exports = Moobarn
