// @flow
import cloneDeep from 'clone-deep'
import isodate from '@segment/isodate'
import isObject from 'isobject'

import { flatten } from '../../utils/flat'
import guessValueType from './guess_type'
import * as valueTypes from '../../constants/value_types'

import type {
  JSONObject,
  FieldStatistic,
  StringStatistic,
  NumberStatistic
} from '../../types'

type Statistics = { [fieldname: string]: FieldStatistic }

function defaultStats(): FieldStatistic {
  return {
    [valueTypes.STRING]: {
      count: 0,
      values: new Map()
    },
    [valueTypes.NUMBER]: {
      count: 0,
      values: new Map()
    },
    [valueTypes.DATE]: {
      count: 0,
      values: new Map()
    },
    [valueTypes.DATETIME]: {
      count: 0,
      values: new Map()
    },
    [valueTypes.BOOLEAN]: {
      count: 0,
      values: new Map([[true, 0], [false, 0]])
    },
    [valueTypes.URL]: 0,
    [valueTypes.IMAGE_URL]: 0,
    [valueTypes.AUDIO_URL]: 0,
    [valueTypes.VIDEO_URL]: 0,
    [valueTypes.NULL]: 0,
    [valueTypes.UNDEFINED]: 0,
    [valueTypes.LOCATION]: 0
  }
}

export default function createMemoizedStats() {
  let stats: Statistics = {}
  const dataMemo = []

  return function getFieldStatistics(data: Array<JSONObject>) {
    const { added, removed } = diffArrays(dataMemo, data)
    if (!added.length && !removed.length) return cloneDeep(stats)
    if (removed.length) {
      // Anything removed, calculate all the stats
      // TODO: more efficient stats on removal
      stats = {}
      data.forEach(item => addItemStats(item, stats))
    } else {
      // Only added items -> only need to process new items
      added.forEach(item => addItemStats(item, stats))
    }
    return cloneDeep(stats)
  }
}

function addItemStats(item: JSONObject = {}, stats: Statistics) {
  const flattened = flatten(item, { delimiter: '\uffff' })
  Object.keys(flattened).forEach(function(key) {
    // flattened item can include empty objects, which we just ignore
    if (isObject(flattened[key])) return
    if (!stats[key]) stats[key] = defaultStats()
    addFieldStats(flattened[key], stats[key])
  })
}

function addFieldStats(value: any, fieldStats: FieldStatistic) {
  const type = guessValueType(value)
  if (typeof fieldStats[type] === 'number') {
    fieldStats[type] += 1
    return
  }
  switch (type) {
    case valueTypes.ARRAY:
      let arrayStats = fieldStats[valueTypes.ARRAY]
      if (arrayStats === undefined) {
        arrayStats = fieldStats[valueTypes.ARRAY] = {
          count: 0,
          lengthMin: +Infinity,
          lengthMax: -Infinity,
          valueStats: defaultStats()
        }
      }
      addArrayStats(value, arrayStats)
      return
    case valueTypes.STRING:
      addStringStats(value, fieldStats[valueTypes.STRING])
      return
    case valueTypes.NUMBER:
      addNumberStats(value, fieldStats[valueTypes.NUMBER])
      return
    case valueTypes.DATE:
      const [year, month, day] = value.split('-').map(Number)
      // Add 12 hours -> middle of day
      const dateAsNumber =
        new Date(year, month - 1, day).getTime() + 12 * 60 * 60 * 1000
      addNumberStats(dateAsNumber, fieldStats[valueTypes.DATE])
      return
    case valueTypes.DATETIME:
      addNumberStats(isodate.parse(value), fieldStats[valueTypes.DATETIME])
      return
    case valueTypes.BOOLEAN:
      fieldStats[valueTypes.BOOLEAN].count += 1
      fieldStats[valueTypes.BOOLEAN].values.set(
        value,
        fieldStats[valueTypes.BOOLEAN].values.get(value) + 1
      )
      return
    default:
      // $FlowFixMe - flow doesn't realise that type is not values above
      fieldStats[type].count += 1
  }
}

function addArrayStats(
  value: [],
  stats: $NonMaybeType<$ElementType<FieldStatistic, 'array'>>
) {
  if (value.length > stats.lengthMax) stats.lengthMax = value.length
  if (value.length < stats.lengthMin) stats.lengthMin = value.length
  stats.count += 1
  value.forEach(function(item) {
    addFieldStats(item, stats.valueStats)
  })
}

function addNumberStats(value: number, stats: NumberStatistic) {
  stats.count += 1
  const { min, max, variance, mean } = statReduce(stats, value, stats.count - 1)
  stats.min = min
  stats.max = max
  stats.variance = variance
  stats.mean = mean
  if (stats.values.has(value))
    stats.values.set(value, stats.values.get(value) + 1)
  else stats.values.set(value, 1)
}

function addStringStats(value: string, stats: StringStatistic) {
  stats.count += 1
  const lengthStats = statReduce(
    {
      min: stats.lengthMin,
      max: stats.lengthMax,
      variance: stats.lengthVariance,
      mean: stats.lengthMean
    },
    value.length,
    stats.count - 1
  )
  const wordStats = statReduce(
    {
      min: stats.wordsMin,
      max: stats.wordsMax,
      variance: stats.wordsVariance,
      mean: stats.wordsMean
    },
    value.split(' ').length,
    stats.count - 1
  )
  stats.lengthMin = lengthStats.min
  stats.lengthMax = lengthStats.max
  stats.lengthVariance = lengthStats.variance
  stats.lengthMean = lengthStats.mean
  stats.wordsMin = wordStats.min
  stats.wordsMax = wordStats.max
  stats.wordsVariance = wordStats.variance
  stats.wordsMean = wordStats.mean
  if (stats.values.has(value))
    stats.values.set(value, stats.values.get(value) + 1)
  else stats.values.set(value, 1)
}

/**
 * Compare two arrays of objects and return items in the second but not in the
 * first (added) and items in the first but not in the second (removed).
 * Compares using strict equality.
 */
export function diffArrays(
  oldArray: Array<Object>,
  newArray: Array<Object>
): { added: Array<Object>, removed: Array<Object> } {
  const added = newArray.filter(v => oldArray.indexOf(v) === -1)
  const removed = oldArray.filter(v => newArray.indexOf(v) === -1)
  return { added, removed }
}

type MathStat = { mean?: number, variance?: number, min?: number, max?: number }

/**
 * Reducer that computes running mean, variance, min and max
 * Adapted from http://www.johndcook.com/blog/standard_deviation/
 * @param {Object} p The previous value for the analysis
 * @param {Number} x New value to be included in analysis
 * @param {Number} i zero-based index of the current element being processed
 * @return {Object} New analysis including `x`
 */
export function statReduce(
  { mean = NaN, variance = NaN, min = +Infinity, max = -Infinity }: MathStat,
  x: number,
  i: number
): $ObjMap<MathStat, <V>(V) => $NonMaybeType<V>> {
  mean = isNaN(mean) ? 0 : mean
  x = x instanceof Date ? +x : x
  const newMean = mean + (x - mean) / (i + 1)
  return {
    mean: newMean,
    min: x < min ? x : min,
    max: x > max ? x : max,
    variance: i < 1 ? 0 : (variance * i + (x - mean) * (x - newMean)) / (i + 1)
  }
}
