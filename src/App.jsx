import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import IntroductionPage from './components/Introduction/IntroductionPage';
import TaskPage from './components/Task/TaskPage';
import FinishPage from './components/Finish/FinishPage';
import './App.css';

function App() {
  return (
    <Router>
      <div className="app">
        <Routes>
          <Route path="/" element={<IntroductionPage />} />
          <Route path="/task" element={<TaskPage />} />
          <Route path="/finish" element={<FinishPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
