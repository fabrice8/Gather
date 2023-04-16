
import type { DBCollections } from './types'
import { MongoClient } from 'mongodb'
import dotenv from 'dotenv'
import NPM from './workers/npm'
import Github from './workers/github'

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

async function start(){
  const Workers = (process.env.WORKERS || '').split(/\s*,\s*/)

  if( !Workers ){
    console.error('No worker defined')
    return
  }

  try {
    const dbc = await dbConnect()
    
    Workers.map( each => {
      switch( each ){
        case 'npm': NPM( dbc ); break
        case 'github': Github( dbc ); break
      }
    } )
  }
  catch( error ){ 
    console.error( error )
    process.exit(0)
  }
}

async function stop(){
  // ISSUE: Rollback to working deployment on DO
  
  console.log('-- WORKERS PAUSED --')
}

/**
 * Run workers 
 * 
 * Control jobs activity with environment
 * variable: PAUSE
 */
String( process.env.PAUSE ) !== 'true' ? start() : stop()