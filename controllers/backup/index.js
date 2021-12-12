const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

class BackupController {
  async init ({
    server,
    defaultBackupIntervalHours,
    defaultBackupFinalScript
  }) {
    this.server = server
    this.defaultBackupIntervalHours = defaultBackupIntervalHours
    this.defaultBackupFinalScript = defaultBackupFinalScript
  }

  async start () {
    if (this.server.FLAG === 'verbose') console.log('[#] Starting backup controller...')
    this.loadState()
  }

  stop () {
    if (this.server.FLAG === 'verbose') console.log('[#] Stopping backup controller...')
  }

  loop () {
    const state = this.loadState()

    state.globalInterval++

    this.server.barn.forEach((value, key) => {
      if (!state.mooIntervals[key]) {
        state.mooIntervals[key] = 0
      }
    })

    for (const prop in state.mooIntervals) {
      const moo = this.server.barn.get(prop)
      if (moo) {
        if (!moo.disabled && moo.backupIntervalHours !== 0 && moo.backupIntervalHours !== null) {
          state.mooIntervals[prop]++
        }
      } else {
        delete state.mooIntervals[prop]
      }
    }

    if (state.globalInterval >= this.defaultBackupIntervalHours) {
      this.backupAll(true)
      state.globalInterval = 0
    }

    for (const prop in state.mooIntervals) {
      const info = this.server.barn.get(prop)
      if (info && info.backupIntervalHours) {
        if (state.mooIntervals[prop] >= info.backupIntervalHours) {
          this.backupMoo(prop)
          state.mooIntervals[prop] = 0
        }
      }
    }

    this.setState(state)
  }

  backupMoo (moo) {
    const info = this.server.barn.get(moo)
    if (info && !info.disabled) {
      this.prepareBackupFolder(moo)

      const dateObj = new Date()
      const [date, time] = dateObj.toISOString().split('T')
      const [year, month, day] = date.split('-')
      const [hour, minute] = time.split(':')

      try {
        fs.copyFileSync(path.join(__dirname, '../..', 'barn', moo, `${moo}.new.db`), path.join(__dirname, '../..', 'barn', moo, 'backup', `${year}_${month}_${day}_${hour}_${minute}_${moo}.db`))

        this.server.setMooInfo(moo, { lastBackup: dateObj.getTime() })

        console.log(`[>] Successfully backed up ${moo} moo at ${dateObj}...`)
      } catch {
        console.log(this.server.backupFailedError(moo))
      }
      if (info.backupFinalScript !== null) {
        spawn(`sh ${info.backupFinalScript}`, [], { shell: true, detached: false, stdio: 'inherit' })
      }
    } else if (!info) {
      console.log(this.server.notFoundError(moo, 'moo'))
    } else {
      console.log(this.server.mooDisabledError(moo))
    }
  }

  backupAll (customIntervals = false) {
    console.log('[%] Backing up moos...')
    this.server.barn.forEach((value, key) => {
      if (!customIntervals) {
        if (value && !value.disabled && value.backupIntervalHours === null) {
          this.backupMoo(key)
        }
      } else {
        if (value && !value.disabled) {
          this.backupMoo(key)
        }
      }
    })
  }

  prepareBackupFolder (moo) {
    if (!fs.existsSync(path.join(__dirname, '../..', 'barn', moo, 'backup'))) {
      fs.mkdirSync(path.join(__dirname, '../..', 'barn', moo, 'backup'), { recursive: true }, (e) => {
        throw e
      })
    }
  }

  loadState () {
    try {
      return require('./state.json')
    } catch {
      console.log(this.server.notFoundForError('state.json', 'backup controller'))
      return this.setState()
    }
  }

  setState (info, replace = false) {
    if (!info) {
      const mooIntervals = Object.fromEntries(this.server.barn)
      for (const moo in mooIntervals) {
        mooIntervals[moo] = 0
      }

      const initInfo = {
        globalInterval: 0,
        mooIntervals
      }

      return fs.writeFileSync(path.join(__dirname, 'state.json'), JSON.stringify(initInfo, null, '\t'), e => {
        throw e
      })
    }

    let data

    if (replace) {
      data = info
    } else {
      data = this.loadState()
    }

    fs.writeFileSync(path.join(__dirname, 'state.json'), JSON.stringify({ ...data, ...info }, null, '\t'), e => {
      throw e
    })
  }
}

// factory
module.exports = new BackupController()
