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
  // =====================================================================================
  //  censorship provides for metaneeds.  (things we avoid for now to move conflict
  //    resolution forward in the face of mistrust or privacy)
  //  if we can formalize an agreeable depiction of metaneeds, it should align as a
  //  feature to include.
  // =====================================================================================
  //  Censorship plan:
  //    Networks can hold messages stating a request to censor a word or pattern.
  //    These messages can be made in ways that are hard to see, or public, but somehow they can be made.
  //    Finances must be provided to back the request (likely very small at first) to discourage
  //      wanton censorhip.
  //    System analyzes what will be censored as a result of request, and only censors
  //    these things if enough is paid to match a formula that increases as
  //      inverse 50% of total item count - number of items censored.
  //    such that it hits infinity once 50% of all things are censored
  //      TODO: update formula so it cannot be gamed by making multiple requests.
  //          likely by using total of all censored items, rather than just requested ones.
  //
  //    Missing ideas:
  //      - time limit to censorship (maybe could be implicit in frequency of discussing topic?)  or dcould use similar price scale with max of 100 years or somesuch (price hits infinity at max)
  //      - moving censorship from one pattern to another by outbidding
  // =====================================================================================
  // feature seems fine to me, would make me money
  //    not my ideal behavior, censoring people, but I can get on board with it
  //
  //  expect to check for these requests within the core components of library, so as to allow them
  //  coming from arbitrary channels
  //  will need to add financial information to database content
  //        so this makes karl (and whoever runs a mirror or joins karl's community) money
  //        and it helps people with secrets keep their secrets
  //
  //        the exchange is hopefully ease in making this software, so that disparate communities can
  //        share stored information more readily
  //            information that is not censored, or communication that provides for dealing with
  //            the concerns resulting in censorship

  // we still have a problem with getting/putting the current net when the netdbid is not
  // known but the local id is.
  // it would really help for nets to have globally unique ids
  // note: this is done only when we _are_ the net, so we can narrow things down by looking
  // only for ids that are of nets themselves
  //
  // this is kind of a special case for get
  //    type = 'net'
  //    netdbid = null
  //    fields = { id: netid }
  //    AND detail@$type = dbid@item

  // Call get() to retrieve objects.  The object fields will be filled relative to the
  // provided netdbid.  If netdbid is null, objects will be retrieved for the network
  // that produced them.  Only objects with the provided fields are returned.
  // An array of objects is returned:
  // [ {
  //     dbid: unique_number_for_object,
  //     id: 'network local id',
  //     cust: {optional network-specific data},
  //     origid: 'id in network that produced object',
  //     orignetid: 'id of network that produced object',
  //     ... type-specific schema fields ...
  //   },
  //   ...
  // ]
  metashare.get = async (type, netdbid = null, fields = {}) => {
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
      _join[colref.name + '.@net'] = 'item.@net'
      if (colref.optional) { items = items.leftJoin(_table, _join) } else { items = items.join(_table, _join) }
    }
    if (type === 'user') {
      items = items
        .leftJoin('priv', 'item.dbid@item', 'priv.dbid@item')
    }
    items = items
      .where('item.$type', type)
    if (netdbid === null) {
      items = items
        .andWhere('item.dbid@item', knex.ref('item.detail@$type'))
    } else {
      items = items
        .andWhere('item.@net', netdbid)
    }
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

  // Call put() when the provided network creates a new object.
  // May also be used to create new networks by providing netdbid = null
  // Networks may be passed to this call multiple times to update them.
  // Other objects may not be altered at this time.  (add when needed)
  // object:
  //    {
  //      id: "required",
  //      cust: { /* optional network-local subobj data */ },
  //      .. any type-specific fields
  //    }
  // A .dbid field will be added to object.
  // The dbid is additionally returned by the put function.
  metashare.put = async (type, netdbid, object) => {
    const schema = schemas[type]
    await knex.transaction(async (trx) => {
      async function makeDetails (object) {
        const details = {}
        if (object.dbid) {
          details['dbid@item'] = object.dbid
        }
        for (let colnonref of Object.values(schema.vals)) {
          if (colnonref.name in object) {
            if (colnonref.type === 'json') {
              details[colnonref.col] = JSON.stringify(object[colnonref.name])
            } else {
              details[colnonref.col] = object[colnonref.name]
            }
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
        return details
      }

      // TODO: these choices to use special case options are more error-prone than
      //       coding separate functions for the special cases.
      //       please upgrade when time, and add tests for separate functions
      if (type === 'net' && !netdbid) {
        const netitem = await trx('item')
          .select('dbid@item as dbid')
          .where('$type', 'net')
          .andWhere('dbid', knex.ref('detail@$type'))
          .andWhere('id', object.id)

        if (netitem.length > 2) { throw new Error('net id is not unique') }

        if (netitem.length === 1) {
          object.dbid = netitem[0].dbid
          await trx('net')
            .update(await makeDetails(object))
            .where('dbid@item', object.dbid)

          if ('cust' in object) {
            await trx('item')
              .update({ cust: JSON.stringify(object.cust) })
              .where('dbid@item', object.dbid)
          }

          return object.dbid
        }
      }
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
      await trx(type).insert(await makeDetails(object))
      if (type === 'user' && 'priv' in object) {
        await trx('priv').insert({
          'dbid@item': object.dbid,
          'priv': JSON.stringify(object.priv)
        })
      }
    })

    return object.dbid
  }

  // Call mirror() to mirror an object onto a new network.
  // Current assumption is that this called for all objects, so that they may be referenced by local id.
  // object:
  // {
  //    id: "required id for this network"
  //    cust: { optional network-specific data }
  // }
  // A dbid field is added to object, but it just contains the passed dbid value.
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
