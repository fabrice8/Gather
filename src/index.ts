
import type { DBCollections } from './types'
import dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
import NPM from './workers/npm'

dotenv.config()

async function dbConnect(): Promise<DBCollections> {
  // Connect to the database server
  const dbclient = new MongoClient( process.env.MONGODB_SERVER as string )
  await dbclient.connect()

  console.log(`-- Connected successfully database: <${process.env.MONGODB_SERVER}/${process.env.MONGODB_NAME}> --`)
  const db = dbclient.db( process.env.MONGODB_NAME as string )
  
  return {
    Stages: db.collection('stages'),
    Authors: db.collection('authors'),
    Keywords: db.collection('keywords')
  }
}

;( async () => {
  const Workers = (process.env.WORKERS || '').split(/\s*,\s*/)

  if( !Workers ){
    console.error('No worker defined')
    return
  }

  const dbc = await dbConnect()
  
  Workers.map( each => {
    switch( each ){
      case 'npm': NPM( dbc ); break
    }
  } )
})()