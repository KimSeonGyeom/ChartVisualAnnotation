import { useNavigate } from 'react-router-dom';
import './TutorialPage.css';

export default function TutorialPage() {
  const navigate = useNavigate();

  return (
    <div className="tutorial-page">
      <div className="tutorial-container">
        <h1 className="tutorial-title">Tutorial</h1>

        <p className="tutorial-desc">
          In this task, you will be given <strong>one chart image</strong> and <strong>one caption sentence</strong> that describes the chart.
        </p>
        <p className="tutorial-desc">
          Your goal is to <strong>visually highlight the information conveyed in the caption directly</strong> on the original <strong>chart image</strong>.
        </p>

        <div className="tutorial-caption-box">
          <strong>Caption: </strong>"In 2015 and 2017, Mozart was the most performed composer, with more than 3,000 performances each year."
        </div>

        <div className="tutorial-images">
          <div className="tutorial-image-box">
            <img src="/suneung_images/suneung1.png" alt="Original chart" />
            <p className="tutorial-image-label"><strong>Left: original chart image.</strong></p>
          </div>
          <div className="tutorial-image-box">
            <img src="/suneung_images/suneung1_annotation.png" alt="Annotated chart" />
            <p className="tutorial-image-label"><strong>Right: Highlights made based on the caption.</strong></p>
          </div>
        </div>

        <p className="tutorial-desc">
          On the left, you will see the original chart image.<br />
          On the right, you will see an example of how the information from the caption can be visually represented on the chart.
        </p>

        <p className="tutorial-desc">
          There are no right or wrong answers.<br />
          <strong>Feel free to draw on any parts of the chart that you think are important based on the caption!</strong>
        </p>

        <button
          className="btn btn-primary btn-large tutorial-btn"
          onClick={() => navigate('/task')}
        >
          Start Task
        </button>
      </div>
    </div>
  );
}
