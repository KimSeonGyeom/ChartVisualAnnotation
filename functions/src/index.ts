import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { generateAnnotatedCharts } from './gemini/client';
import { uploadImageToStorage } from './utils/storage';

admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();

const geminiApiKey = defineSecret('GEMINI_API_KEY');
const MAX_AUTO_RETRIES = 3;

/**
 * Shared generation logic used by both the Firestore trigger and the retry scheduler.
 */
async function runGeneration(
  trialDocId: string,
  trialRef: admin.firestore.DocumentReference,
  trialData: admin.firestore.DocumentData,
  apiKey: string
): Promise<void> {
  const prolificId = trialData.sessionId?.split('_')[0] || 'unknown';

  const sessionDoc = await db.collection('sessions').doc(trialData.sessionId).get();
  if (!sessionDoc.exists) throw new Error(`Session ${trialData.sessionId} not found`);
  const sessionData = sessionDoc.data()!;

  const setDoc = await db.collection('sets').doc(sessionData.assignedSetId).get();
  if (!setDoc.exists) throw new Error(`Set ${sessionData.assignedSetId} not found`);
  const setData = setDoc.data()!;

  const stimulusIndex = parseInt(trialData.trialId.replace('trial_', '')) - 1;
  const chartIndex = setData.indices[stimulusIndex];
  if (chartIndex === undefined) throw new Error(`Stimulus index ${stimulusIndex} not found in set`);

  const userDrawingImageUrl = trialData.annotation?.imageUrl;
  if (!userDrawingImageUrl) {
    throw new Error(
      `Missing required human drawing image URL for trial ${trialDocId}. ` +
      `Expected trials/{id}.annotation.imageUrl to be present.`
    );
  }

  const inputData = {
    chartIndex,
    imageUrl: `/suneung_images/suneung${chartIndex}.png`,
    caption: trialData.caption || '',
    userDrawingBase64: userDrawingImageUrl,
    userIntent: trialData.responses?.drawing_help_intent || '',
    prolificId,
    apiKey,
  };

  console.log(`📊 Processing chart ${chartIndex} for worker ${prolificId}`);

  const { image1Base64, image2Base64 } = await generateAnnotatedCharts(inputData);

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

  await trialRef.update({
    'generation.status': 'completed',
    'generation.completedAt': admin.firestore.FieldValue.serverTimestamp(),
    'generation.reviewImageUrl1': url1,
    'generation.reviewImageUrl2': url2,
    'generation.prolificId': prolificId,
  });

  console.log(`✅ Generated annotations for trial ${trialDocId} (worker: ${prolificId})`);
}

/**
 * Firestore trigger: When a new trial is created, generate 2 annotated charts.
 * Trial document ID format: {prolificId}_{timestamp}_{trialId}
 */
export const processTrialAnnotation = onDocumentCreated(
  {
    document: 'trials/{trialDocId}',
    secrets: [geminiApiKey],
    timeoutSeconds: 540,
    memory: '1GiB',
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
        'generation.retryCount': 0,
      });

      await runGeneration(trialDocId, snapshot.ref, trialData, geminiApiKey.value());
    } catch (error: any) {
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
 * Scheduled retry: Every minute, pick up failed trials and re-run generation.
 * Skips trials that have already been retried MAX_AUTO_RETRIES times.
 * Sets status to 'processing' before retrying to prevent duplicate runs.
 */
export const retryFailedTrials = onSchedule(
  {
    schedule: 'every 1 minutes',
    secrets: [geminiApiKey],
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async () => {
    const failedSnapshot = await db.collection('trials')
      .where('generation.status', '==', 'failed')
      .get();

    if (failedSnapshot.empty) {
      console.log('✅ No failed trials to retry');
      return;
    }

    const retryTasks: Promise<void>[] = [];

    failedSnapshot.forEach((doc) => {
      const trialData = doc.data();
      const retryCount = trialData.generation?.retryCount ?? 0;

      if (retryCount >= MAX_AUTO_RETRIES) {
        console.log(`⏭️ Skipping trial ${doc.id} - max retries (${MAX_AUTO_RETRIES}) reached`);
        return;
      }

      const prolificId = trialData.sessionId?.split('_')[0] || 'unknown';
      console.log(`🔁 Retrying trial ${doc.id} (worker: ${prolificId}, attempt: ${retryCount + 1}/${MAX_AUTO_RETRIES})`);

      retryTasks.push((async () => {
        try {
          await doc.ref.update({
            'generation.status': 'processing',
            'generation.startedAt': admin.firestore.FieldValue.serverTimestamp(),
            'generation.retryCount': admin.firestore.FieldValue.increment(1),
          });

          await runGeneration(doc.id, doc.ref, trialData, geminiApiKey.value());
        } catch (error: any) {
          console.error(`❌ Retry failed for trial ${doc.id} (worker: ${prolificId}):`, error.message);
          await doc.ref.update({
            'generation.status': 'failed',
            'generation.completedAt': admin.firestore.FieldValue.serverTimestamp(),
            'generation.errorMessage': error.message,
          });
        }
      })());
    });

    await Promise.all(retryTasks);
    console.log(`🔁 Retry cycle complete. Processed ${retryTasks.length} failed trial(s).`);
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
