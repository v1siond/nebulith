/**
 * Tests for Pixellab API client
 */
import {
  generatePixflux,
  animateWithText,
  animateWithTextV3Start,
  animateV3CheckStatus,
  estimateSkeleton,
  animateWithSkeleton,
  getBalance,
  base64ToDataUrl,
  imageToBase64,
} from '@/lib/pixellab'

// Mock fetch globally
const mockFetch = jest.fn()
global.fetch = mockFetch

describe('Pixellab API Client', () => {
  beforeEach(() => {
    mockFetch.mockClear()
  })

  describe('base64ToDataUrl', () => {
    it('converts base64 to data URL', () => {
      const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      const result = base64ToDataUrl(base64)

      expect(result).toBe(`data:image/png;base64,${base64}`)
    })

    it('handles empty string', () => {
      const result = base64ToDataUrl('')
      expect(result).toBe('data:image/png;base64,')
    })
  })

  describe('generatePixflux', () => {
    it('sends correct request format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          image: { base64: 'test-image-base64' },
          usage: { usd: 0.01 }
        })
      })

      await generatePixflux('test-api-key', {
        description: 'pixel warrior',
        width: 64,
        height: 64,
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = mockFetch.mock.calls[0]

      expect(url).toBe('https://api.pixellab.ai/v1/generate-image-pixflux')
      expect(options.method).toBe('POST')
      expect(options.headers['Authorization']).toBe('Bearer test-api-key')

      const body = JSON.parse(options.body)
      expect(body.description).toBe('pixel warrior')
      expect(body.image_size).toEqual({ width: 64, height: 64 })
    })

    it('includes optional parameters when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ image: { base64: 'test' }, usage: { usd: 0 } })
      })

      await generatePixflux('key', {
        description: 'test',
        width: 64,
        height: 64,
        noBackground: true,
        seed: 12345,
        textGuidance: 10,
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.no_background).toBe(true)
      expect(body.seed).toBe(12345)
      expect(body.text_guidance_scale).toBe(10)
    })

    it('formats init_image correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ image: { base64: 'test' }, usage: { usd: 0 } })
      })

      await generatePixflux('key', {
        description: 'test',
        width: 64,
        height: 64,
        initImage: 'base64-image-data',
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.init_image).toEqual({ base64: 'base64-image-data' })
    })

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () => 'Validation error'
      })

      await expect(
        generatePixflux('key', { description: 'test', width: 64, height: 64 })
      ).rejects.toThrow('422')
    })
  })

  describe('animateWithText', () => {
    it('sends correct request format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          images: [{ base64: 'frame1' }, { base64: 'frame2' }],
          usage: { usd: 0.02 }
        })
      })

      await animateWithText('key', {
        description: 'warrior',
        action: 'walking',
        referenceImage: 'ref-base64',
      })

      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('https://api.pixellab.ai/v1/animate-with-text')

      const body = JSON.parse(options.body)
      expect(body.description).toBe('warrior')
      expect(body.action).toBe('walking')
      expect(body.reference_image).toEqual({ base64: 'ref-base64' })
      expect(body.image_size).toEqual({ width: 64, height: 64 })
    })

    it('includes direction when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ images: [], usage: { usd: 0 } })
      })

      await animateWithText('key', {
        description: 'test',
        action: 'idle',
        referenceImage: 'ref',
        direction: 'south-east',
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.direction).toBe('south-east')
    })
  })

  describe('animateWithTextV3Start', () => {
    it('sends to v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ background_job_id: 'job-123' })
      })

      const result = await animateWithTextV3Start('key', {
        firstFrame: 'frame-base64',
        action: 'running',
        width: 128,
        height: 128,
      })

      const [url] = mockFetch.mock.calls[0]
      expect(url).toBe('https://api.pixellab.ai/v2/animate-with-text-v3')
      expect(result.backgroundJobId).toBe('job-123')
    })

    it('calculates frame count within pixel budget', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ background_job_id: 'job' })
      })

      await animateWithTextV3Start('key', {
        firstFrame: 'frame',
        action: 'running',
        width: 256,
        height: 256,
        frameCount: 20, // Too many for 256x256
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      // Max frames for 256x256 = 524288 / (256*256) = 8
      expect(body.frame_count).toBeLessThanOrEqual(8)
    })

    it('does NOT include image_size (v3 infers from first_frame)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ background_job_id: 'job' })
      })

      await animateWithTextV3Start('key', {
        firstFrame: 'frame',
        action: 'idle',
        width: 128,
        height: 128,
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.image_size).toBeUndefined()
      expect(body.first_frame).toEqual({ base64: 'frame' })
    })
  })

  describe('animateV3CheckStatus', () => {
    it('sends GET request to correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'processing' })
      })

      await animateV3CheckStatus('key', 'job-123')

      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('https://api.pixellab.ai/v2/background-jobs/job-123')
      expect(options.method).toBe('GET')
    })

    it('returns completed status with images', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'completed',
          last_response: {
            images: [{ base64: 'img1' }, { base64: 'img2' }]
          },
          usage: { usd: 0.05 }
        })
      })

      const result = await animateV3CheckStatus('key', 'job-123')

      expect(result.status).toBe('completed')
      expect(result.last_response?.images).toHaveLength(2)
    })
  })

  describe('estimateSkeleton', () => {
    it('sends correct request format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          skeleton: [{ x: 0.5, y: 0.2, label: 'NOSE' }],
          usage: { usd: 0.01 }
        })
      })

      await estimateSkeleton('key', {
        size: 64,
        image: 'sprite-base64',
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.image_size).toEqual({ width: 64, height: 64 })
      expect(body.image).toEqual({ base64: 'sprite-base64' })
    })
  })

  describe('animateWithSkeleton', () => {
    it('sends skeleton keypoints array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          images: [{ base64: 'frame' }],
          usage: { usd: 0.02 }
        })
      })

      const keypoints = [
        [{ x: 0.5, y: 0.2, label: 'NOSE' }],
        [{ x: 0.5, y: 0.25, label: 'NOSE' }],
      ]

      await animateWithSkeleton('key', {
        size: 64,
        referenceImage: 'ref-base64',
        skeletonKeypoints: keypoints,
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.skeleton_keypoints).toEqual(keypoints)
      expect(body.reference_image).toEqual({ base64: 'ref-base64' })
    })
  })

  describe('getBalance', () => {
    it('returns balance from API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ balance: 12.34 })
      })

      const result = await getBalance('key')
      expect(result.balance).toBe(12.34)
    })
  })
})


describe('Animation Keyframes', () => {
  // Import after mocking
  const {
    applyPoseToSkeleton,
    getAnimationKeyframes,
    ANIMATION_POSES,
    ANIMATION_TYPES
  } = require('@/lib/animation-keyframes')

  describe('ANIMATION_POSES', () => {
    it('has all expected animation types', () => {
      expect(ANIMATION_POSES).toHaveProperty('running')
      expect(ANIMATION_POSES).toHaveProperty('walking')
      expect(ANIMATION_POSES).toHaveProperty('idle')
      expect(ANIMATION_POSES).toHaveProperty('attacking')
      expect(ANIMATION_POSES).toHaveProperty('jumping')
    })

    it('each pose has 3 keyframes', () => {
      for (const [name, poses] of Object.entries(ANIMATION_POSES)) {
        expect(Array.isArray(poses)).toBe(true)
        expect((poses as unknown[]).length).toBe(3)
      }
    })
  })

  describe('applyPoseToSkeleton', () => {
    it('applies offsets to skeleton points', () => {
      const baseSkeleton = [
        { x: 0.5, y: 0.5, label: 'NOSE' },
        { x: 0.4, y: 0.6, label: 'LEFT ARM' },
      ]

      const offset = {
        'NOSE': { x: 0.1, y: -0.1 },
        'LEFT ARM': { x: -0.05, y: 0.05 },
      }

      const result = applyPoseToSkeleton(baseSkeleton, offset)

      expect(result[0].x).toBeCloseTo(0.6)
      expect(result[0].y).toBeCloseTo(0.4)
      expect(result[1].x).toBeCloseTo(0.35)
      expect(result[1].y).toBeCloseTo(0.65)
    })

    it('clamps values to 0-1 range', () => {
      const baseSkeleton = [
        { x: 0.95, y: 0.05, label: 'TEST' },
      ]

      const offset = {
        'TEST': { x: 0.2, y: -0.2 },
      }

      const result = applyPoseToSkeleton(baseSkeleton, offset)

      expect(result[0].x).toBe(1)  // Clamped
      expect(result[0].y).toBe(0)  // Clamped
    })
  })

  describe('getAnimationKeyframes', () => {
    it('returns array of pose arrays', () => {
      const baseSkeleton = [
        { x: 0.5, y: 0.5, label: 'NOSE' },
      ]

      const result = getAnimationKeyframes(baseSkeleton, 'idle')

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(3)
      expect(Array.isArray(result[0])).toBe(true)
    })

    it('falls back to idle for unknown action', () => {
      const baseSkeleton = [{ x: 0.5, y: 0.5, label: 'NOSE' }]

      const result = getAnimationKeyframes(baseSkeleton, 'unknown-action')
      const idleResult = getAnimationKeyframes(baseSkeleton, 'idle')

      expect(result.length).toBe(idleResult.length)
    })
  })

  describe('ANIMATION_TYPES', () => {
    it('exports list of available types', () => {
      expect(Array.isArray(ANIMATION_TYPES)).toBe(true)
      expect(ANIMATION_TYPES.length).toBeGreaterThan(0)
      expect(ANIMATION_TYPES).toContain('running')
      expect(ANIMATION_TYPES).toContain('idle')
    })
  })
})
