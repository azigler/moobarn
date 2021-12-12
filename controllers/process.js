const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const findProcess = require('find-process')
const pidusage = require('pidusage')

class ProcessController {
  async init ({
    server,
    defaultMooPort
  }) {
    this.server = server
    this.defaultMooPort = defaultMooPort
  }

  start () {
    if (this.server.FLAG === 'verbose') console.log('[#] Starting moo process controller...')
  }

  stop () {
    if (this.server.FLAG === 'verbose') console.log('[#] Stopping moo process controller...')
  }

  async isMooStarted (moo) {
    const info = this.server.barn.get(moo)
    if (info.pid !== null) {
      try {
        await pidusage(info.pid)
        return true
      } catch {
        this.server.setMooInfo(moo, { pid: null })
        return false
      }
    } else {
      return false
    }
  }

  async startMoo (moo, port) {
    const info = this.server.barn.get(moo)
    if (info) {
      if (!(await this.isMooStarted(moo)) && !info.disabled) {
        console.log(`[>] Starting ${moo} moo @ ${info.mooArgs.ipv4 !== null ? info.mooArgs.ipv4 : 'localhost'}:${info.mooArgs.port || this.controllers.get('process').defaultMooPort}...`)
        if (port) {
          info.mooArgs.port = port
        }
        this.spawn(moo, info)
      } else if (!info.disabled) {
        console.log(this.server.mooAlreadyStartedError(moo))
      } else {
        console.log(this.server.mooDisabledError(moo))
      }
    } else {
      console.log(this.server.notFoundError(moo, 'moo'))
    }
  }

  startAll () {
    console.log('[%] Starting all moos...')
    this.server.barn.forEach((value, key) => {
      if ((!value || !value.pid) && !value.disabled) {
        this.startMoo(key)
      }
    })
  }

  async stopMoo (moo) {
    if (this.server.barn.get(moo)) {
      if (await this.isMooStarted(moo)) {
        console.log(`[X] Stopping ${moo} moo...`)
        this.killMoo(moo)
      } else {
        console.log(this.server.mooAlreadyStoppedError(moo))
      }
    } else {
      console.log(this.server.notFoundError(moo, 'moo'))
    }
  }

  stopAll () {
    console.log('[%] Stopping all moos...')
    this.server.barn.forEach((value, key) => {
      if (value && value.pid) {
        this.stopMoo(key)
      }
    })
  }

  killMoo (moo) {
    const info = this.server.barn.get(moo)
    try {
      process.kill(info.pid)
    } finally {
      this.server.setMooInfo(moo, { pid: null })
    }
  }

  resurrect () {
    this.server.barn.forEach(async (value, key) => {
      if (value.pid) {
        try {
          await pidusage(value.pid)
        } catch (e) {
          console.log(`[^] Resurrecting ${key} moo @ ${value.mooArgs.ipv4 !== null ? value.mooArgs.ipv4 : 'localhost'}:${value.mooArgs.port || this.controllers.get('process').defaultMooPort}...`)
          this.spawn(key, value)
        }
      }
    })
  }

  spawn (moo, info = {}) {
    const [preMooArgs, postMooArgs, port] = this.prepareMooArgs(info)
    let startDb

    try {
      startDb = this.shuffleMooFiles(moo, 'db')
    } catch (e) {
      return console.log(e)
    }

    this.shuffleMooFiles(moo, 'log')

    const logStream = fs.createWriteStream(path.join(__dirname, '../', 'barn', moo, `${moo}.new.log`))
    logStream.on('open', async () => {
      const barnPath = path.join(__dirname, '../', 'barn')
      const mooPath = path.join(__dirname, '../', 'toaststunt', 'build', 'moo')

      if (info.isolated) {
        process.chdir(path.join(__dirname, '../', 'barn', moo))
        fs.mkdirSync(path.join(__dirname, '..', 'barn', moo, 'files'), { recursive: true }, (e) => {
          throw e
        })
        fs.mkdirSync(path.join(__dirname, '..', 'barn', moo, 'executables'), { recursive: true }, (e) => {
          throw e
        })
      }

      let stdio = [logStream, logStream, logStream]
      if (info.mooArgs.scriptFile !== null) {
        console.log(`NOTE: Unable to write to ${moo}.new.log due to -f argument`)
        stdio = ['inherit', 'inherit', 'inherit']
      }

      const child = spawn(`${mooPath} ${preMooArgs}${barnPath}/${moo}/${startDb} ${barnPath}/${moo}/${moo}.new.db ${postMooArgs}${port}`, [], { shell: true, detached: true, stdio })

      let pid = child.pid

      const arr = await this.findMooProcesses()
      arr.forEach(ele => {
        if (ele.cmd === `${mooPath} ${preMooArgs}${barnPath}/${moo}/${startDb} ${barnPath}/${moo}/${moo}.new.db ${postMooArgs}${port}`) {
          pid = ele.pid
        }
      })

      this.server.setMooInfo(moo, {
        pid,
        lastStart: new Date().getTime()
      })
    })
  }

  shuffleMooFiles (moo, filetype = 'db') {
    const fileExists = fs.existsSync(path.join(__dirname, '../', 'barn', moo, `${moo}.${filetype}`))
    const newFileExists = fs.existsSync(path.join(__dirname, '../', 'barn', moo, `${moo}.new.${filetype}`))
    const sourceFileExists = fs.existsSync(path.join(__dirname, '../', 'barn', moo, `${moo}.source.${filetype}`))

    if (!fileExists && !newFileExists && sourceFileExists) {
      if (filetype === 'db') return `${moo}.source.db`
    }

    if (fileExists && newFileExists) {
      fs.copyFileSync(path.join(__dirname, '../', 'barn', moo, `${moo}.${filetype}`), path.join(__dirname, '../', 'barn', moo, `${moo}.old.${filetype}`))
      fs.copyFileSync(path.join(__dirname, '../', 'barn', moo, `${moo}.new.${filetype}`), path.join(__dirname, '../', 'barn', moo, `${moo}.${filetype}`))
      if (filetype === 'db') return `${moo}.db`
    }

    if (!fileExists && newFileExists) {
      fs.copyFileSync(path.join(__dirname, '../', 'barn', moo, `${moo}.new.${filetype}`), path.join(__dirname, '../', 'barn', moo, `${moo}.${filetype}`))
      if (filetype === 'db') return `${moo}.db`
    }

    if (fileExists && !newFileExists) {
      if (filetype === 'db') return `${moo}.db`
    }

    if (filetype === 'db') {
      throw this.server.notFoundError(moo, 'db')
    }
  }

  async findMooProcesses (format = 'array') {
    const processes = await findProcess('name', 'moo')
    if (format === 'array') {
      return processes
    } else if (format === 'pretty') {
      if (processes.length) {
        console.log(`\nFound moo-related process${processes.length > 1 ? 'es' : ''}:`)
        processes.forEach((proc, i) => {
          console.log(`  ${i + 1}. ${proc.name} [${proc.pid}] ${proc.cmd}`)
        })
        console.log()
      } else {
        console.log('\n No moo-related processes found\n')
      }
    }
  }

  prepareMooArgs (info) {
    let emergencyMode = ''
    let scriptFile = ''
    let scriptLine = ''
    const logFile = ''
    const clearLastMove = ''
    let waifType = ''
    const outbound = ''
    const tls = ''
    let ipv4 = ''
    let ipv6 = ''
    let port = this.defaultMooPort

    if (info.mooArgs) {
      if (info.mooArgs.emergencyMode === true) {
        emergencyMode = '-e '
      }

      if (info.mooArgs.clearLastMove === true) {
        emergencyMode = '-m '
      }

      if (info.mooArgs.outbound === true) {
        emergencyMode = '+O '
      }

      if (info.mooArgs.outbound === false) {
        emergencyMode = '-O '
      }

      if (info.mooArgs.tls === true) {
        emergencyMode = '+T '
      }

      if (info.mooArgs.tls === false) {
        emergencyMode = '-T '
      }

      if (info.mooArgs.scriptFile !== null) {
        scriptFile = `-f ${info.mooArgs.scriptFile} `
      }

      if (info.mooArgs.scriptLine !== null) {
        scriptLine = `-c ${info.mooArgs.scriptLine} `
      }

      if (info.mooArgs.logFile !== null) {
        scriptLine = `-l ${info.mooArgs.scriptLine} `
      }

      if (info.mooArgs.waifType !== null) {
        waifType = `-w ${info.mooArgs.scriptLine} `
      }

      if (info.mooArgs.ipv4 !== null) {
        ipv4 = `-4 ${info.mooArgs.ipv4} `
      }

      if (info.mooArgs.ipv6 !== null) {
        ipv6 = `-6 ${info.mooArgs.ipv6} `
      }

      if (info.mooArgs.port !== 7777) {
        port = info.mooArgs.port
      }

      const preMooArgs = `${emergencyMode}${scriptFile}${scriptLine}${logFile}${clearLastMove}${waifType}`
      const postMooArgs = `${outbound}${tls}${ipv4}${ipv6}`

      return [preMooArgs, postMooArgs, `-p ${port}`]
    } else {
      return ['', '', `-p ${port}`]
    }
  }

  determineUptime (pidusageObj) {
    const formatUptime = (sec) => {
      const pad = (s) => {
        return (s < 10 ? '0' : '') + s
      }

      sec /= 1000
      const days = Math.floor(sec / (60 * 60 * 24))
      const hours = Math.floor(sec / (60 * 60))
      const minutes = Math.floor(sec % (60 * 60) / 60)
      const seconds = Math.floor(sec % 60)

      return `${days ? days + 'd' : ''}${hours ? pad(hours % ((days || 1) * 24)) + 'h' : ''}${minutes ? pad(minutes) + 'm' : ''}${pad(seconds)}s`
    }

    return formatUptime(pidusageObj.elapsed)
  }

  determineMemory (pidusageObj) {
    return `${(pidusageObj.memory / 1024 / 1024).toFixed(2)} MB`
  }

  determineProcessor (pidusageObj) {
    return pidusageObj.cpu.toFixed(2) + '%'
  }
}

// factory
module.exports = new ProcessController()
