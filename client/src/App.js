import './App.css'
import React from "react";
import {BrowserRouter as Router, Route, Routes} from 'react-router-dom'
import Convert from './Pages/Convert';
import LearnSign from './Pages/LearnSign';
import Simulate from './Pages/Simulate';
import Navbar from './Components/Navbar';

function App() {
  return(
    <Router>
      <div>
        <Navbar />
        <Routes>
          <Route exact path='/sign-kit/convert' element={<Convert />} />
          <Route exact path='/sign-kit/learn-sign' element={<LearnSign />} />
          <Route exact path='/sign-kit/simulate' element={<Simulate />} />
        </Routes>
      </div>
    </Router>
  )
}

export default App;