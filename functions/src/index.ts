import { Bucket } from '@google-cloud/storage';
import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { generateImgExp } from './client';

admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();

const geminiApiKey = defineSecret('GEMINI_API_KEY');

async function uploadImageToStorage(
  bucket: Bucket,
  filePath: string,
  base64Data: string
): Promise<string> {
  const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Image, 'base64');

  const file = bucket.file(filePath);

  await file.save(buffer, {
    metadata: {
      contentType: 'image/png',
      cacheControl: 'public, max-age=31536000',
      metadata: {
        generatedAt: new Date().toISOString(),
      },
    },
  });

  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${filePath}`;
}

/**
 * Firestore trigger: trial created → Gemini experimental annotation (drawing-guided).
 * Baseline PNGs for pairwise review live under **public/{folder}/baseImages/** on the deployed site (not generated here).
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

    const prolificId = trialData.sessionId?.split('_')[0] || 'unknown';

    console.log(`🔄 Starting generation for trial ${trialDocId} (worker: ${prolificId})`);

    try {
      await snapshot.ref.update({
        'generation.status': 'processing',
        'generation.startedAt': admin.firestore.FieldValue.serverTimestamp(),
        'generation.prolificId': prolificId,
      });

      const sessionDoc = await db.collection('sessions').doc(trialData.sessionId).get();
      if (!sessionDoc.exists) {
        throw new Error(`Session ${trialData.sessionId} not found`);
      }
      const sessionData = sessionDoc.data()!;

      const setDoc = await db.collection('sets').doc(sessionData.assignedSetId).get();
      if (!setDoc.exists) {
        throw new Error(`Set ${sessionData.assignedSetId} not found`);
      }

      const setData = setDoc.data()!;
      const stimulusIndex = parseInt(trialData.trialId.replace('trial_', '')) - 1;
      const chartIndex = setData.indices[stimulusIndex];

      if (chartIndex === undefined) {
        throw new Error(`Stimulus index ${stimulusIndex} not found in set`);
      }

      const workerDrawingImageUrl = trialData.annotation?.imageUrl;
      if (!workerDrawingImageUrl || typeof workerDrawingImageUrl !== 'string') {
        throw new Error(
          `Missing trials/{id}.annotation.imageUrl (http(s) URL) for trial ${trialDocId}.`
        );
      }

      const inputData = {
        chartIndex,
        caption: trialData.caption || '',
        userIntent: trialData.responses?.drawing_help_intent || '',
        prolificId,
        apiKey: geminiApiKey.value(),
        workerDrawingImageUrl,
      };

      console.log(`📊 Processing chart ${chartIndex} for worker ${prolificId}`);

      const { imgExpBase64 } = await generateImgExp(inputData);

      const bucket = storage.bucket();
      const timestamp = Date.now();
      const imgExp = await uploadImageToStorage(
        bucket,
        `reviews/${prolificId}/${trialDocId}_imgExp_${timestamp}.png`,
        imgExpBase64
      );

      await snapshot.ref.update({
        'generation.status': 'completed',
        'generation.completedAt': admin.firestore.FieldValue.serverTimestamp(),
        'generation.imgExp': imgExp,
        'generation.prolificId': prolificId,
      });

      console.log(`✅ Generated experimental annotation for trial ${trialDocId} (worker: ${prolificId})`);
    } catch (error: any) {
      console.error(
        `❌ Generation failed for trial ${trialDocId} (worker: ${prolificId}):`,
        error.message
      );

      await snapshot.ref.update({
        'generation.status': 'failed',
        'generation.completedAt': admin.firestore.FieldValue.serverTimestamp(),
        'generation.errorMessage': error.message,
        'generation.prolificId': prolificId,
      });
    }
  }
);

/** GET /checkGenerationStatus?prolificId=XXX&sessionId=YYY */
export const checkGenerationStatus = onRequest(
  { cors: true },
  async (req, res) => {
    const { prolificId, sessionId } = req.query;

    if (!prolificId || !sessionId) {
      res.status(400).json({ error: 'Missing prolificId or sessionId' });
      return;
    }

    try {
      const trialsSnapshot = await db
        .collection('trials')
        .where('sessionId', '==', sessionId)
        .get();

      const statusMap: Record<string, unknown> = {};

      trialsSnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        statusMap[data.trialId as string] = {
          status: data.generation?.status ?? 'pending',
          imgExp: data.generation?.imgExp,
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
