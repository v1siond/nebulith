import { LevelData, TileDefinition, RGBA } from '../types'
import GameAsset from '@/interfaces/GameAsset'

function parseColor(colorStr: string): RGBA {
  const match = colorStr.match(/[\d.]+/g)
  if (!match || match.length < 3) {
    return { r: 255, g: 255, b: 255, a: 1 }
  }
  return {
    r: parseFloat(match[0]),
    g: parseFloat(match[1]),
    b: parseFloat(match[2]),
    a: match[3] ? parseFloat(match[3]) : 1
  }
}

interface LegacyAnimationInfo {
  shouldAnimate: (char: string) => boolean
  animationByChar: (char: string) => 'move' | 'brightup' | 'move_brightup' | null
  intervalByChar: (char: string) => number
  shouldBlock: (char: string) => boolean
}

export function convertLegacyAsset(
  asset: GameAsset,
  colorMap: Record<string, string>,
  fillColorMap: Record<string, string>,
  animationInfo: LegacyAnimationInfo,
  defaultFillColor: RGBA = { r: 0, g: 0, b: 0, a: 0.4 }
): LevelData {
  const uniqueChars = new Set<string>()

  for (const line of asset.template) {
    for (const char of line) {
      uniqueChars.add(char)
    }
  }

  const tileDefinitions: Record<string, TileDefinition> = {}

  for (const char of uniqueChars) {
    const color = colorMap[char] ? parseColor(colorMap[char]) : { r: 255, g: 255, b: 255, a: 0.8 }
    const fillColor = fillColorMap[char] ? parseColor(fillColorMap[char]) : defaultFillColor

    tileDefinitions[char] = {
      char,
      color,
      fillColor,
      isAnimated: animationInfo.shouldAnimate(char),
      animationType: animationInfo.animationByChar(char),
      animationInterval: animationInfo.intervalByChar(char),
      isBlocking: animationInfo.shouldBlock(char)
    }
  }

  return {
    template: asset.template,
    tileDefinitions
  }
}

export default convertLegacyAsset
