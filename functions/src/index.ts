import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { generateAnnotatedCharts } from './gemini/client';
import { uploadImageToStorage } from './utils/storage';

admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();

// Define secret for Gemini API key
const geminiApiKey = defineSecret('GEMINI_API_KEY');

/**
 * Firestore trigger: When a new trial is created, generate 2 annotated charts
 * 
 * Trial document ID format: {prolificId}_{timestamp}_{trialId}
 * This ensures each worker's trials are uniquely identified
 */
export const processTrialAnnotation = onDocumentCreated(
  {
    document: 'trials/{trialDocId}',
    secrets: [geminiApiKey],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log('No data associated with the event');
      return;
    }
    
    const trialDocId = event.params.trialDocId as string;
    const trialData = snapshot.data();
    
    // Extract prolificId from the trial data (stored in session)
    const prolificId = trialData.sessionId?.split('_')[0] || 'unknown';
    
    console.log(`🔄 Starting generation for trial ${trialDocId} (worker: ${prolificId})`);
    
    try {
      // Update status to processing
      await snapshot.ref.update({
        'generation.status': 'processing',
        'generation.startedAt': admin.firestore.FieldValue.serverTimestamp(),
        'generation.prolificId': prolificId, // Track which worker this belongs to
      });

      // Fetch the session to get set assignment
      const sessionDoc = await db.collection('sessions').doc(trialData.sessionId).get();
      if (!sessionDoc.exists) {
        throw new Error(`Session ${trialData.sessionId} not found`);
      }
      const sessionData = sessionDoc.data()!;

      // Fetch the assigned set to get stimulus data
      const setDoc = await db.collection('sets').doc(sessionData.assignedSetId).get();
      if (!setDoc.exists) {
        throw new Error(`Set ${sessionData.assignedSetId} not found`);
      }

      // Find the specific stimulus for this trial
      const setData = setDoc.data()!;
      const stimulusIndex = parseInt(trialData.trialId.replace('trial_', '')) - 1;
      const chartIndex = setData.indices[stimulusIndex];
      
      if (chartIndex === undefined) {
        throw new Error(`Stimulus index ${stimulusIndex} not found in set`);
      }

      // Prepare input for Gemini
      const userDrawingImageUrl = trialData.annotation?.imageUrl;
      if (!userDrawingImageUrl) {
        throw new Error(
          `Missing required human drawing image URL for trial ${trialDocId}. ` +
          `Expected trials/{id}.annotation.imageUrl to be present.`
        );
      }

      const inputData = {
        chartIndex: chartIndex,
        imageUrl: `/suneung_images/suneung${chartIndex}.png`,
        caption: trialData.caption || '',
        // Human drawing is mandatory for the "with drawing" generation path.
        userDrawingBase64: userDrawingImageUrl,
        userIntent: trialData.responses?.drawing_help_intent || '',
        prolificId: prolificId, // Include worker ID for logging
        apiKey: geminiApiKey.value(), // Pass API key from secret
      };

      console.log(`📊 Processing chart ${chartIndex} for worker ${prolificId}`);

      // Call Gemini to generate 2 versions:
      // Version 1: Based on original chart only (no worker drawing)
      // Version 2: Based on original chart + worker's pen drawing overlay
      const { image1Base64, image2Base64 } = await generateAnnotatedCharts(inputData);

      // Upload to Firebase Storage with prolificId in the path for organization
      const bucket = storage.bucket();
      const timestamp = Date.now();
      const [url1, url2] = await Promise.all([
        uploadImageToStorage(
          bucket, 
          `reviews/${prolificId}/${trialDocId}_no_drawing_${timestamp}.png`, 
          image1Base64
        ),
        uploadImageToStorage(
          bucket, 
          `reviews/${prolificId}/${trialDocId}_with_drawing_${timestamp}.png`, 
          image2Base64
        ),
      ]);

      // Update Firestore with results
      await snapshot.ref.update({
        'generation.status': 'completed',
        'generation.completedAt': admin.firestore.FieldValue.serverTimestamp(),
        'generation.reviewImageUrl1': url1,  // Version without worker drawing
        'generation.reviewImageUrl2': url2,  // Version with worker drawing
        'generation.prolificId': prolificId,
      });

      console.log(`✅ Generated annotations for trial ${trialDocId} (worker: ${prolificId})`);
      
    } catch (error: any) {
      // Log error once, not repeatedly
      console.error(`❌ Generation failed for trial ${trialDocId} (worker: ${prolificId}):`, error.message);
      
      await snapshot.ref.update({
        'generation.status': 'failed',
        'generation.completedAt': admin.firestore.FieldValue.serverTimestamp(),
        'generation.errorMessage': error.message,
        'generation.prolificId': prolificId,
      });
    }
  }
);

/**
 * HTTP endpoint to check generation status for a specific worker
 * GET /checkGenerationStatus?prolificId=XXX&sessionId=YYY
 */
export const checkGenerationStatus = onRequest(
  { cors: true },
  async (req, res) => {
    const { prolificId, sessionId } = req.query;

    if (!prolificId || !sessionId) {
      res.status(400).json({ error: 'Missing prolificId or sessionId' });
      return;
    }

    try {
      // Query all trials for this session
      const trialsSnapshot = await db.collection('trials')
        .where('sessionId', '==', sessionId)
        .get();

      const statusMap: Record<string, any> = {};

      trialsSnapshot.forEach((doc) => {
        const data = doc.data();
        statusMap[data.trialId] = {
          status: data.generation?.status || 'pending',
          reviewImageUrl1: data.generation?.reviewImageUrl1 || null,
          reviewImageUrl2: data.generation?.reviewImageUrl2 || null,
        };
      });

      res.status(200).json({
        prolificId,
        sessionId,
        trials: statusMap,
      });

    } catch (error: any) {
      console.error('Error checking generation status:', error);
      res.status(500).json({ error: error.message });
    }
  }
);
