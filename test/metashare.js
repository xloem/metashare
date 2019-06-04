const fs = require('fs')
const Metashare = require('../metashare/metashare')

describe('metashare db', () => {
  var metashare
  describe('default database', () => {
    it('constructs without error', async () => {
      metashare = await Metashare()
    })
    it('destroys without error', async () => {
      metashare.destroy()
    })
  })
  describe('test database', () => {
    try { fs.unlink('db/test.sqlite') } catch (e) {}
    it('constructs without error', async () => {
      metashare = await Metashare({ client: 'sqlite3', connection: { filename: 'db/test.sqlite' }, debug: true })
    })
    it('destroys without error', async () => {
      metashare.destroy()
    })
  })
})
