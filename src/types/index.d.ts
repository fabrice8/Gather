
import { Collection } from 'mongodb'

export type PublicationSource = 'npm' | 'github' | 'medium'
export type Publication = {
  name: string
  source: PublicationSource
}
export type Author = {
  email: string
  name?: string
  url?: string
  username?: string
  blog?: string
  location?: string
  publications?: Publication[]
}
export type Keyword = {
  value: string
  timestamp: number
}
export type Stage = {
  worker: PublicationSource
  lastKeyword: Keyword
}

export type DBCollections = {
  Stages: Collection
  Authors: Collection
  Keywords: Collection
}