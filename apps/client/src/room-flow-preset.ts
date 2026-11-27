// Fixed Flow Lab v1 preset. The source is the current album cover, not the demo image.
export const roomFlowPreset = {
  "format": "flow-lab-config",
  "version": 1,
  "parameters": {
    "blur": 107,
    "strength": 20,
    "scale": 3,
    "speed": 0.8,
    "angle": 0,
    "spin": 0,
    "swirl": -24,
    "ripple": 0,
    "chromatic": 0,
    "wave": 0,
    "pixelate": 0,
    "halftone": 0,
    "grain": 0,
    "vignette": 0,
    "directional": 42,
    "zoomBlur": 11,
    "lens": -37,
    "sharpen": 0,
    "exposure": 0,
    "contrast": 9,
    "saturation": 6,
    "temperature": 0,
    "imageAngle": 0,
    "imageSpin": 8,
    "leftAngle": 0,
    "leftSpin": -7,
    "rightAngle": 0,
    "rightSpin": -8
  },
  "filterEnabled": {
    "blur": true,
    "strength": true,
    "swirl": true,
    "ripple": true,
    "chromatic": true,
    "wave": true,
    "pixelate": true,
    "halftone": true,
    "grain": true,
    "vignette": true,
    "directional": true,
    "zoomBlur": true,
    "lens": true,
    "sharpen": true,
    "exposure": true,
    "contrast": true,
    "saturation": true,
    "temperature": true
  },
  "view": {
    "splitView": true,
    "allowOverflow": true,
    "showGuides": false,
    "stackPresets": true
  },
  "playback": {
    "paused": false,
    "time": 116.99955239998418,
    "filterRotationPhase": 0,
    "centerRotationPhase": 0.6676250908022379,
    "leftRotationPhase": -5.011075901925036,
    "rightRotationPhase": -6.2099704903877555
  },
  "image": {
    "width": 1400,
    "height": 1100
  }
} as const;

export function coverCrop(sourceWidth: number, sourceHeight: number, width: number, height: number): readonly [number, number, number, number] {
  if (sourceWidth * height > sourceHeight * width) {
    const cropWidth = sourceHeight * width / height;
    return [(sourceWidth - cropWidth) / 2, 0, cropWidth, sourceHeight] as const;
  }
  const cropHeight = sourceWidth * height / width;
  return [0, (sourceHeight - cropHeight) / 2, sourceWidth, cropHeight] as const;
}
