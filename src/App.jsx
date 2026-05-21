import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import IntroductionPage from './components/Introduction/IntroductionPage';
import TutorialPage from './components/Tutorial/TutorialPage';
import TaskPage from './components/Task/TaskPage';
import ReviewPage from './components/Review/ReviewPage';
import FinishPage from './components/Finish/FinishPage';
import AdminPage from './components/Admin/AdminPage';
import './App.css';

function App() {
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
