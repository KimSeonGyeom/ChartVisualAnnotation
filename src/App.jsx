import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import IntroductionPage from './components/Introduction/IntroductionPage';
import TutorialPage from './components/Tutorial/TutorialPage';
import TaskPage from './components/Task/TaskPage';
import ReviewPage from './components/Review/ReviewPage';
import FinishPage from './components/Finish/FinishPage';
import AdminPage from './components/Admin/AdminPage';
import { useStudyStore, getChartAssetFolder } from './stores/useStudyStore';
import './App.css';

// /**
//  * Local dev (`npm run dev`) only: seed a session from caption.json so Task / Review can load
//  * without going through consent flow. Introduction still shows at `/` first.
//  */
// function useDevPreviewBootstrap() {
//   const [ready, setReady] = useState(!import.meta.env.DEV);

//   useEffect(() => {
//     if (!import.meta.env.DEV) return undefined;

//     let cancelled = false;

//     (async () => {
//       try {
//         const res = await fetch(`/${getChartAssetFolder()}/caption.json`);
//         if (!res.ok) throw new Error(`Failed to load captions: ${res.status}`);
//         const data = await res.json();
//         if (cancelled) return;

//         useStudyStore.setState({
//           participant: {
//             prolificId: 'preview-dev',
//             studyId: 'cva-preview',
//             startedAt: Date.now(),
//           },
//           assignedSet: {
//             id: 'set_0',
//             charts: [2, 3, 4],
//           },
//           chartCaptions: data,
//           currentTrialIndex: 0,
//           trialTimings: [],
//           consentGiven: true,
//         });
//       } catch (e) {
//         console.error('[dev preview] Failed to seed session:', e);
//       } finally {
//         if (!cancelled) setReady(true);
//       }
//     })();

//     return () => {
//       cancelled = true;
//     };
//   }, []);

//   return ready;
// }

function App() {
  // const devPreviewReady = useDevPreviewBootstrap();

  // if (import.meta.env.DEV && !devPreviewReady) {
  //   return (
  //     <div className="app app-preview-loading">
  //       <p>Loading dev preview session…</p>
  //     </div>
  //   );
  // }

  return (
    <Router>
      <div className="app">
        <Routes>
          <Route path="/" element={<IntroductionPage />} />
          <Route path="/tutorial" element={<TutorialPage />} />
          <Route path="/task" element={<TaskPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/finish" element={<FinishPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
