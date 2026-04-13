import * as tf from '@tensorflow/tfjs';
import * as blazeface from '@tensorflow-models/blazeface';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

let blazefaceModel: blazeface.BlazeFaceModel | null = null;
let cocoModel: cocoSsd.ObjectDetection | null = null;

let isReady = false;

// Tracking state variables
let score = 100;
let consecutiveNoFaceCount = 0;
let consecutiveLookingAwayCount = 0;
let consecutivePhoneCount = 0;

async function init() {
  await tf.ready();
  blazefaceModel = await blazeface.load();
  cocoModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
  isReady = true;
  self.postMessage({ type: 'ready' });
}

init();

self.onmessage = async (e) => {
  if (!isReady || !blazefaceModel || !cocoModel) return;

  if (e.data.type === 'process_frame') {
    const bitmap = e.data.bitmap as ImageBitmap;
    if (!bitmap) return;

    try {
      // 1. Attention Analysis
      const returnTensors = false;
      const facePredictions = await blazefaceModel.estimateFaces(bitmap as unknown as HTMLCanvasElement, returnTensors);
      
      let lastDistraction: 'no_face' | 'looking_away' | null = null;

      if (facePredictions.length > 0) {
        consecutiveNoFaceCount = 0;
        const face = facePredictions[0] as blazeface.NormalizedFace;
        const nose = face.landmarks ? (face.landmarks as any)[2] : null;
        
        if (nose) {
          const bbWidth = (face.bottomRight as [number, number])[0] - (face.topLeft as [number, number])[0];
          const centerX = (face.topLeft as [number, number])[0] + (bbWidth / 2);
          const noseOffset = Math.abs(nose[0] - centerX);
          
          if (noseOffset > bbWidth * 0.3) {
            consecutiveLookingAwayCount++;
          } else {
            consecutiveLookingAwayCount = 0;
            score = Math.min(100, score + 1);
          }
        }
      } else {
        consecutiveNoFaceCount++;
        consecutiveLookingAwayCount = 0;
      }

      if (consecutiveNoFaceCount > 5) {
        lastDistraction = 'no_face';
        score = Math.max(0, score - 5);
      } else if (consecutiveLookingAwayCount > 7) { 
        lastDistraction = 'looking_away';
        score = Math.max(0, score - 3);
      }

      // 2. Phone Detection Analysis
      const objectPredictions = await cocoModel.detect(bitmap as unknown as HTMLCanvasElement);
      const phonePrediction = objectPredictions.find(p => p.class === 'cell phone');
      
      let isPhoneDetected = false;
      let phoneConfidence = 0;

      if (phonePrediction && phonePrediction.score > 0.60) {
        consecutivePhoneCount++;
        phoneConfidence = phonePrediction.score;
      } else {
        consecutivePhoneCount = 0;
      }

      // Buffer: Must be seen for 3 analysis cycles (~6 seconds total at 2s/cycle)
      if (consecutivePhoneCount >= 2) { 
        isPhoneDetected = true;
      }

      // Post results back
      self.postMessage({
        type: 'results',
        data: {
          attention: { score, lastDistraction },
          phone: { isPhoneDetected, confidence: phoneConfidence }
        }
      });
    } catch (err) {
      console.error('[AI Worker] Error:', err);
    } finally {
      bitmap.close(); // Important memory cleanup!
    }
  }
};
