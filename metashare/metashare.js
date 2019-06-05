const Knex = require('knex')

module.exports = async function (dbconfig = {
  client: 'sqlite3',
  connection: {
    filename: 'db/metashare.sqlite'
  }
}
) {
  // still need to
  //  - [ ] update bridge code to assume new interface

  const metashare = {}

  if (dbconfig.client === 'sqlite3') { dbconfig.useNullAsDefault = true }

  const knex = Knex(dbconfig)

  const typeNames = ['net', 'user', 'prof', 'post', 'topic', 'opin']

  // =====================================================================
  // In order to copy values between nodejs objects and the database,
  // the database structure itself is used as the model definition.
  //
  // metashare.types() lists the object types (i.e. table names)
  // metashare.schema(type) lists the object attributes (i.e. table columns)
  //
  // To change them, modify the database schema creation logic below.
  //
  // Additionally, all objects have attributes of the 'item' table:
  // - 'id' a required network-specific id
  // - 'cust' optional json data
  // ======================================================================

  if (!await knex.schema.hasTable('item')) {
    await knex.schema.createTable('item', function (table) {
      table.comment('Network-local items, one for each.  Details are stored in separate tables under detail dbid@item')
      table.increments('dbid@item')
      table.integer('detail@$type').unsigned().notNullable().references('dbid@item').inTable('item')
        .comment('Index in item details table.')
      table.integer('@net').unsigned().notNullable().references('dbid@item').inTable('net')
      table.string('id').notNullable()
        .comment('Should be the most obvious string, to reduce clashing between independent bridge implementations.  Choose capitalization and whole name of original first choice UUID made by creator.')
      table.enu('$type', typeNames).notNullable()
        .comment('Table to find item details in.')
      table.unique(['@net', '$type', 'id'])
      table.unique(['@net', 'detail@$type'])
      table.jsonb('cust')
        .comment('network-local data')
    })
  }
  if (!await knex.schema.hasTable('net')) {
    await knex.schema.createTable('net', function (table) {
      table.comment('Net detail table')
      table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
        .comment('references item with type=net')
      table.timestamp('time', { useTz: false }).notNullable()
      table.string('name')
      table.string('where')
    })
  }
  if (!await knex.schema.hasTable('priv')) {
    await knex.schema.createTable('priv', function (table) {
      table.comment('Holds private user information to be shared only with them.')
      table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
        .comment('references item with type=user')
      table.jsonb('priv')
        .comment('private key material etc')
    })
  }
  if (!await knex.schema.hasTable('user')) {
    await knex.schema.createTable('user', function (table) {
      table.comment('User detail table -- see prof for real details')
      table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
        .comment('references item with type=user')
      table.timestamp('time', { useTz: false }).notNullable()
    })
  }
  if (!await knex.schema.hasTable('prof')) {
    await knex.schema.createTable('prof', function (table) {
      table.comment('Profile detail table')
      table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
        .comment('references item with type=prof')
      table.timestamp('time', { useTz: false }).notNullable()
      table.integer('@user').unsigned().notNullable().references('dbid@item').inTable('user')
      table.enu('attr', ['name', 'about', 'picurl']) // be sure to update ENUM HACK below
      table.string('val')
    })
  }
  if (!await knex.schema.hasTable('post')) {
    await knex.schema.createTable('post', function (table) {
      table.comment('Post detail table')
      table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
        .comment('references item with type=post')
      table.timestamp('time', { useTz: false }).notNullable()
      table.integer('@user').unsigned().notNullable().references('dbid@item').inTable('user')
      table.integer('reply@post').unsigned().references('dbid@item')
      table.integer('@topic').unsigned().references('dbid@item').inTable('topic')
      table.integer('share@post').unsigned().references('dbid@item')
      table.string('msg')
    })
  }
  if (!await knex.schema.hasTable('topic')) {
    await knex.schema.createTable('topic', function (table) {
      table.comment('Topic detail table')
      table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
        .comment('references item with type=topic')
      table.timestamp('time', { useTz: false })
      table.string('name')
    })
  }
  if (!await knex.schema.hasTable('opin')) {
    await knex.schema.createTable('opin', function (table) {
      table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
        .comment('references item with type=opin')
      table.timestamp('time', { useTz: false }).notNullable()
      table.integer('@user').unsigned().notNullable().references('dbid@item').inTable('user')
      table.integer('what@item').unsigned().notNullable().references('dbid@item').inTable('item')
      table.enu('how', ['like', 'follow']) // be sure to update ENUM HACK below
      table.float('value').notNullable()
        .comment('>0 for specifying, <=0 for reverting')
    })
  }

  const schemas = {}
  for (let typename of typeNames) {
    const colsRef = {}
    const colsNonref = {}
    const typeColumnInfo = await knex(typename).columnInfo()
    for (let column in typeColumnInfo) {
      const parts = column.split('@', 2)
      if (parts.length < 2) {
        colsNonref[column] = {
          col: column,
          name: column,
          type: typeColumnInfo[column].type,
          optional: typeColumnInfo[column].nullable
        }
      } else {
        if (parts[0] === 'dbid') continue // primary key ref kept implicit
        colsRef[parts[0] || parts[1]] = {
          col: column,
          name: parts[0] || parts[1],
          type: parts[1],
          optional: typeColumnInfo[column].nullable
        }
      }
    }
    schemas[typename] = {
      refs: colsRef,
      vals: colsNonref
    }
  }
  // ENUM HACK
  schemas.prof.vals.attr.type = 'enum'
  schemas.prof.vals.attr.enums = ['name', 'about', 'picurl']
  schemas.opin.vals.how.type = 'enum'
  schemas.opin.vals.how.enums = ['like', 'follow']

  metashare.types = () => typeNames.slice()
  metashare.schema = (type) => schemas[type]

  // TODO: provide for censorship option?  to allow karl to continue work more easily
  //    we believe karl can resist inhibition and would like more rapid aid
  //    karl reports he is really worn out with regard to internal mediation
  //    and he would like to just struggle to work, and is happy to pursue whichever
  //    path kind of ends up influencing him
  //  2 options: mark item as censored
  //    OR: convert item to hash so is not even in database, but can be recognized,
  //      and then mark as censored
  //
  //  we're thinking as this reaches a point of actual workability, so will the choices
  //  made in its design.  sw is far cry from functioning atm and will likely need some more
  //  redesign to actually work, due to how _much_ data there will be to process.
  //    to confirm, the approach of this sw design does not accomodate the amount of
  //    data it is expected to encounter, even on startup.
  //      karl is an experienced coder and enjoys working through problems as
  //      they happen
  //
  //  censorship provides for metaneeds.  (things we avoid for now to move conflict
  //    resolution forward in the face of mistrust or privacy)
  //  if we can formalize an agreeable depiction of metaneeds, it should align as a
  //  feature to include.

  metashare.get = async (type, netdbid, fields = {}) => {
    const schema = schemas[type]
    const selection = [
      'item.detail@$type as dbid',
      'item.id',
      'item.cust',
      'orig.id as origid',
      'orignet.id as orignetid'
    ]
    for (let col of Object.values(schema.vals)) {
      selection.push(type + '.' + (col.name === col.col ? col.name : col.col + ' as ' + col.name))
    }
    for (let colref of Object.values(schema.refs)) {
      selection.push(colref.name + '.id as ' + colref.name)
    }
    if (type === 'user') {
      selection.push('priv.priv')
    }
    var items = knex('item')
      .select(selection)
      .join(type, 'item.detail@$type', type + '.dbid@item')
      .join({ orig: 'item' }, 'item.detail@$type', 'orig.dbid@item')
      .join({ orignet: 'item' }, 'orig.@net', 'orignet.dbid@item')
    for (let colref of Object.values(schema.refs)) {
      const _table = {}
      _table[colref.name] = 'item'
      const _join = {}
      _join[colref.name + '.detail@$type'] = type + '.' + colref.col
      _join[colref.name + '.@net'] = netdbid
      if (colref.optional) { items = items.leftJoin(_table, _join) } else { items = items.join(_table, _join) }
    }
    if (type === 'user') {
      items = items
        .leftJoin('priv', 'item.dbid@item', 'priv.dbid@item')
    }
    items = items
      .where('item.$type', type)
      .andWhere('item.@net', netdbid)
    if ('dbid' in fields) {
      items = items
        .andWhere('dbid', fields.dbid)
    }
    if ('id' in fields) {
      items = items
        .andWhere('item.id', fields.id)
    }
    for (let col of Object.values(schema.vals)) {
      const field = fields[col.name]
      if (field === undefined) continue
      items = items
        .andWhere(knex.ref(col.col).withSchema(type),
          knex.ref(field))
    }
    for (let colref in schema.refs) {
      const id = fields[colref.name]
      if (id === undefined) continue
      items = items
        .andWhere(colref.name + '.id', knex.ref(id))
    }

    items = await items.orderBy('dbid')

    // process json and null
    const vals = Object.values(schema.vals).concat(Object.values(schema.refs))
    vals.push({ type: 'json', name: 'cust', optional: true })
    if (type === 'user') { vals.push({ type: 'json', name: 'priv', optional: true }) }
    for (let item of items) {
      for (let val of vals) {
        if (item[val.name] === null) { delete item[val.name] } else if (val.type === 'json') { item[val.name] = JSON.parse(item[val.name]) }
      }
    }

    return items
  }

  metashare.put = async (type, netdbid, object) => {
    // this creates a new object from the provided network

    const schema = schemas[type]
    await knex.transaction(async (trx) => {
      object.dbid = (await trx('item')
        .insert({
          '@net': netdbid || 0,
          'detail@$type': 0,
          id: object.id,
          '$type': type,
          cust: object.cust && JSON.stringify(object.cust)
        }))[0]
      const update = { 'detail@$type': object.dbid }
      if (type === 'net') { update['@net'] = object.dbid }
      await trx('item').update(update).where('dbid@item', object.dbid)
      const details = {}
      details['dbid@item'] = object.dbid
      for (let colnonref of Object.values(schema.vals)) {
        if (colnonref.name in object) {
          if (colnonref.type === 'json') { details[colnonref.col] = JSON.stringify(object[colnonref.name]) } else { details[colnonref.col] = object[colnonref.name] }
        }
      }
      for (let colref of Object.values(schema.refs)) {
        if (colref.name in object) {
          let req = trx('item')
            .first('dbid@item')
            .where('id', object[colref.name])
            .andWhere('@net', netdbid)
          if (colref.type !== 'item') {
            req = req
              .andWhere('$type', colref.type)
          }
          const res = await req
          if (!res) throw new Error('referenced ' + colref.name + ' does not exist: ' + object[colref.name])
          details[colref.col] = res['dbid@item']
        }
      }
      await trx(type).insert(details)
      if (type === 'user' && 'priv' in object) {
        await trx('priv').insert({
          'dbid@item': object.dbid,
          'priv': JSON.stringify(object.priv)
        })
      }
    })

    return object.dbid
  }

  metashare.mirror = async (type, netdbid, dbid, object) => {
    await knex('item')
      .insert({
        '@net': netdbid,
        'detail@$type': dbid,
        id: object.id,
        '$type': type,
        cust: object.cust && JSON.stringify(object.cust)
      })
    object.dbid = dbid
  }

  metashare.destroy = async () => {
    await knex.destroy()
  }

  return metashare
}
