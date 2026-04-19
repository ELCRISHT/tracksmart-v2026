import * as tf from '@tensorflow/tfjs';
import * as blazeface from '@tensorflow-models/blazeface';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

let blazefaceModel: blazeface.BlazeFaceModel | null = null;
let cocoModel: cocoSsd.ObjectDetection | null = null;

let isReady = false;

// Tracking state variables
let score = 100;
let consecutiveNoFaceCount = 0;
let consecutivePhoneCount = 0;
let isGlobalPhoneDetected = false;
let lastLogTime = 0; // Throttle logging
const LOG_THROTTLE_MS = 2000; // More frequent logging for debugging
let frameCounter = 0;

// Smoothing buffers for more reliable detection
const phoneDetectionBuffer: boolean[] = [];
const lookingAwayBuffer: boolean[] = [];
const BUFFER_SIZE = 6; // Increased from 2 for more stability (0.2s at 30fps)

async function init() {
  console.log('[AI Worker] Starting initialization...');
  await tf.ready();
  console.log('[AI Worker] TensorFlow ready');
  
  blazefaceModel = await blazeface.load();
  console.log('[AI Worker] BlazeFace model loaded ✓');
  
  cocoModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
  console.log('[AI Worker] COCO-SSD model loaded ✓');
  
  isReady = true;
  console.log('[AI Worker] ✅ All models initialized and ready!');
  self.postMessage({ type: 'ready' });
}

init();

self.onmessage = async (e) => {
  if (!isReady || !blazefaceModel || !cocoModel) return;

  if (e.data.type === 'process_frame') {
    frameCounter++;
    const bitmap = e.data.bitmap as ImageBitmap;
    if (!bitmap) return;

    let tensor: tf.Tensor3D | null = null;
    try {
      // Create tensor to ensure Web Worker compatibility across all browser engines
      try {
        tensor = tf.browser.fromPixels(bitmap);
      } catch (err) {
        console.warn('[AI Worker] Failed to create tensor from bitmap:', err);
        return;
      }
      
      // FRAME PROCESSING START
      if (frameCounter % 5 === 0) {
        console.log(`[AI] 🎬 FRAME #${frameCounter} - Processing...`);
      }
      
      // Get face predictions from BlazeFace
      const facePredictions = await blazefaceModel.estimateFaces(tensor, false);
      
      let lastDistraction: 'no_face' | 'looking_away' | null = null;
      let currentlyLookingAway = false;

      if (facePredictions.length > 0) {
        consecutiveNoFaceCount = 0;
        const face = facePredictions[0] as blazeface.NormalizedFace;
        const landmarks = face.landmarks as [number, number][];
        
        // Extract face geometry
        const faceBox = face.topLeft as [number, number];
        const faceBoxBottom = face.bottomRight as [number, number];
        const faceWidth = faceBoxBottom[0] - faceBox[0];
        const faceHeight = faceBoxBottom[1] - faceBox[1];
        const faceCenterX = faceBox[0] + faceWidth / 2;
        const faceCenterY = faceBox[1] + faceHeight / 2;
        
        // Improved Looking Away Detection using robust head pose estimation
        if (landmarks && landmarks.length >= 6) {
          const rightEye = landmarks[0];
          const leftEye = landmarks[1];
          const nose = landmarks[2];
          const mouth = landmarks[3];
          const rightEar = landmarks[4];
          const leftEar = landmarks[5];
          
          // 1. Horizontal head rotation detection (nose deviation from center)
          const noseHorizontalOffset = Math.abs(nose[0] - faceCenterX);
          const horizontalThreshold = faceWidth * 0.25; // 25% deviation = looking to side
          const isHeadTurned = noseHorizontalOffset > horizontalThreshold;
          
          // 2. Vertical head tilt detection (chin position vs face center)
          const mouthVerticalOffset = Math.abs(mouth[1] - faceCenterY);
          const verticalThreshold = faceHeight * 0.30; // 30% = looking up/down
          const isHeadTilted = mouthVerticalOffset > verticalThreshold;
          
          // 3. Eye gaze consistency check (eyes looking same direction)
          const eyeSpacing = Math.abs(rightEye[0] - leftEye[0]);
          const eyeHeightDiff = Math.abs(rightEye[1] - leftEye[1]);
          const eyesAsymmetric = eyeHeightDiff > eyeSpacing * 0.4; // Squinting or one eye closed
          
          // 4. Face tilt using ear symmetry
          const earHeightDiff = Math.abs(rightEar[1] - leftEar[1]);
          const earDistribution = Math.abs(rightEar[0] - leftEar[0]);
          const isFaceTilted = earHeightDiff > earDistribution * 0.3;
          
          // Decision: Looking away if ANY two conditions are true (robust multi-factor)
          const lookingAwayConditions = [isHeadTurned, isHeadTilted, eyesAsymmetric, isFaceTilted];
          const conditionCount = lookingAwayConditions.filter(Boolean).length;
          
          currentlyLookingAway = conditionCount >= 2; // Need 2+ conditions for detection
          
          if (currentlyLookingAway) {
            lookingAwayBuffer.push(true);
            if (lookingAwayBuffer.length > BUFFER_SIZE) lookingAwayBuffer.shift();
            
            console.log(`[AI] 👀 Looking away detected! Conditions: Turned=${isHeadTurned}, Tilted=${isHeadTilted}, EyesAsym=${eyesAsymmetric}, FaceTilt=${isFaceTilted}`);
          } else {
            lookingAwayBuffer.push(false);
            if (lookingAwayBuffer.length > BUFFER_SIZE) lookingAwayBuffer.shift();
            score = Math.min(100, score + 1);
          }
        }

        // Trigger looking away alert with multi-frame smoothing
        const lookingAwayPercent = (lookingAwayBuffer.filter(Boolean).length / lookingAwayBuffer.length) * 100;
        if (lookingAwayPercent >= 50) { // 50% of recent frames show looking away
          lastDistraction = 'looking_away';
          score = Math.max(0, score - 8);
          console.warn(`[AI] 🚨 LOOKING AWAY ALERT - Confidence: ${lookingAwayPercent.toFixed(0)}%`);
        }

        // No face detected
        if (consecutiveNoFaceCount >= 1) {
          lastDistraction = 'no_face';
          score = Math.max(0, score - 8);
          console.warn(`[AI] 🚨 NO FACE DETECTED`);
        }
      } else {
        consecutiveNoFaceCount++;
        lookingAwayBuffer.push(false);
        if (lookingAwayBuffer.length > BUFFER_SIZE) lookingAwayBuffer.shift();
        
        if (consecutiveNoFaceCount >= 1) {
          lastDistraction = 'no_face';
          score = Math.max(0, score - 8);
          console.warn(`[AI] 🚨 NO FACE DETECTED - Count: ${consecutiveNoFaceCount}`);
        }
      }

      // 2. AGGRESSIVE Phone Detection - Catch actual phones being held
      // OPTIMIZATION: Skip COCO processing every other frame for performance
      let objectPredictions: cocoSsd.DetectedObject[] = [];
      const shouldProcessCOCO = frameCounter % 2 === 0; // Process every other frame
      if (shouldProcessCOCO) {
        objectPredictions = await cocoModel.detect(tensor);
      }
      
      // ALWAYS log detection results on processed frames
      if (shouldProcessCOCO && frameCounter % 10 === 0) {
        console.log(`[AI] 🔍 FRAME #${frameCounter} - COCO detected ${objectPredictions.length} objects`);
        if (objectPredictions.length > 0) {
          console.log(`[AI]   Objects:`, objectPredictions.map(p => `${p.class}(${p.score.toFixed(2)})`).join(', '));
        }
      }
      
      let phoneConfidence = 0;
      let phoneInCurrentFrame = false;

      if (facePredictions.length > 0) {
        const face = facePredictions[0] as blazeface.NormalizedFace;
        const faceBox = face.topLeft as [number, number];
        const faceBoxBottom = face.bottomRight as [number, number];
        const faceWidth = faceBoxBottom[0] - faceBox[0];
        const faceHeight = faceBoxBottom[1] - faceBox[1];
        const faceTop = faceBox[1];
        const faceBottom = faceBoxBottom[1];
        const faceLeft = faceBox[0];
        const faceRight = faceBoxBottom[0];
        
        // Log face detection
        if (frameCounter % 5 === 0) {
          console.log(`[AI]   Face detected at [${faceLeft.toFixed(0)},${faceTop.toFixed(0)}] size:${faceWidth.toFixed(0)}x${faceHeight.toFixed(0)}`);
        }
        
        // STRATEGY 1: Phone detected anywhere in frame
        const allPhonesDetected = objectPredictions.filter(p => p.class === 'cell phone');
        
        // STRATEGY 2: Phone in face region
        const phonesNearFace = allPhonesDetected.filter(p => {
          const bbox = p.bbox;
          const objLeft = bbox[0];
          const objTop = bbox[1];
          const objWidth = bbox[2];
          const objHeight = bbox[3];
          const objRight = objLeft + objWidth;
          const objBottom = objTop + objHeight;
          const objCenterX = (objLeft + objRight) / 2;
          
          // VERY LENIENT positioning
          const isNearFaceHeight = objTop < faceBottom + faceHeight * 1.0 && objBottom > faceTop - faceHeight * 1.0;
          const isInFrameHorizontally = objCenterX > faceLeft - faceWidth * 3 && objCenterX < faceRight + faceWidth * 3;
          const isNotTinyDetection = objWidth > 5 && objHeight > 5;
          
          return isNearFaceHeight && isInFrameHorizontally && isNotTinyDetection;
        });
        
        // Decision logic - Focused on cell phone
        if (phonesNearFace.length > 0) {
          const maxPhoneScore = Math.max(...phonesNearFace.map(h => h.score));
          phoneConfidence = Math.min(maxPhoneScore * 1.5, 0.99);
          phoneInCurrentFrame = true;
          if (frameCounter % 5 === 0) console.warn(`[AI] 📱🚨 PHONE NEAR FACE! Confidence: ${phoneConfidence.toFixed(2)}`);
        } else if (allPhonesDetected.length > 0) {
          phoneConfidence = 0.75;
          phoneInCurrentFrame = true;
          if (frameCounter % 5 === 0) console.warn(`[AI] 📱 PHONE DETECTED ANYWHERE!`);
        }
        
        phoneDetectionBuffer.push(phoneInCurrentFrame);
        if (phoneDetectionBuffer.length > BUFFER_SIZE) phoneDetectionBuffer.shift();
        
        if (phoneInCurrentFrame) {
          consecutivePhoneCount++;
        } else if (consecutivePhoneCount > 0) {
          consecutivePhoneCount--;
        }
      } else {
        if (frameCounter % 5 === 0) {
          console.log(`[AI]   No face detected!`);
        }
        phoneDetectionBuffer.push(false);
        if (phoneDetectionBuffer.length > BUFFER_SIZE) phoneDetectionBuffer.shift();
        if (consecutivePhoneCount > 0) {
          consecutivePhoneCount--;
        }
      }

      // TRIGGER ALERT - IMPROVED LOGIC with hysteresis
      const phoneDetectionRate = phoneDetectionBuffer.length > 0 ? (phoneDetectionBuffer.filter(Boolean).length / phoneDetectionBuffer.length) * 100 : 0;
      
      if (phoneDetectionRate >= 50) { 
        isGlobalPhoneDetected = true;
        score = Math.max(0, score - 15);
        if (frameCounter % 10 === 0) {
          console.warn(`[AI] 🚨🚨🚨 PHONE ALERT TRIGGERED! Rate: ${phoneDetectionRate.toFixed(0)}%, Count: ${consecutivePhoneCount}`);
        }
      } else if (phoneDetectionRate < 25) {
        // Clear immediately when buffer is mostly clean of phones
        isGlobalPhoneDetected = false;
      }

      // Clean up tensor to prevent memory leaks
      if (tensor) {
        tensor.dispose();
      }

      // Debug logging (throttled)
      const now = Date.now();
      if ((lastDistraction || isGlobalPhoneDetected) && now - lastLogTime > LOG_THROTTLE_MS) {
        console.log(`[AI] Distraction: ${lastDistraction || 'none'}, Phone: ${isGlobalPhoneDetected}, Score: ${score}`);
        lastLogTime = now;
      }

      // Post results back
      self.postMessage({
        type: 'results',
        data: {
          attention: { score, lastDistraction },
          phone: { isPhoneDetected: isGlobalPhoneDetected, confidence: phoneConfidence }
        }
      });
    } catch (err) {
      console.error('[AI Worker] Error:', err);
      // Clean up tensor on error too
      if (tensor) {
        try {
          tensor.dispose();
        } catch {
          // Already disposed
        }
      }
    } finally {
      bitmap.close(); // Important memory cleanup!
    }
  }
};
