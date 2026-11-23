require("dotenv").config();

const { app, initializeServices } = require("./app");
const port = Number(process.env.PORT) || 5000;

initializeServices()
  .then(() => app.listen(port, () => console.log(`InterviewPro API listening on port ${port}`)))
  .catch((error) => {
    console.error("Could not start API because a required service failed to connect:", error.message);
    process.exitCode = 1;
  });
