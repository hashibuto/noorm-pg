const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

class Env {
  static terraform(envPath=null) {
    if (envPath === null) {
      let env;
      const dotEnvFile = path.join(process.cwd(), '.env');
      if (fs.existsSync(dotEnvFile)) {
        env = dotenv.parse(fs.readFileSync(dotEnvFile));
        for (let key in env) {
          process.env[key] = env[key];
        }
        console.log("Picked up base environment")
      } else {
        console.log("No base environment defined")
      }

      if (process.env.DOCKER_ENV !== undefined) {
        const dotEnvDockerFile = path.join(process.cwd(), '.env.docker');
        if (fs.existsSync(dotEnvDockerFile)) {
          env = dotenv.parse(fs.readFileSync(dotEnvDockerFile));
          for (let key in env) {
            process.env[key] = env[key];
          }
          console.log("Picked up docker environment")
        } else {
          console.log("No docker environment defined")
        }
      }

      if (process.env.NODE_ENV === 'production') {
        const dotEnvProdFile = path.join(process.cwd(), '.env.prod');
        if (fs.existsSync(dotEnvProdFile)) {
          env = dotenv.parse(fs.readFileSync(dotEnvProdFile));
          for (let key in env) {
            process.env[key] = env[key];
          }
          console.log("Picked up production environment")
        } else {
          console.log("No production environment defined")
        }
      }
    } else {
      console.log("Using .env.json style configs")

      let env, envData;
      const BASE = ".env.json";
      const DOCKER = ".env.docker.json";
      const PROD = ".env.prod.json"
      const enviros = [BASE, DOCKER, PROD];

      enviros.forEach(enviro => {
        if (enviro === DOCKER && process.env.DOCKER_ENV === undefined)
          return;

        if (enviro === PROD && process.env.NODE_ENV !== "production")
          return;

        const file = path.join(envPath, enviro);
        console.log(`Checking for ${file}`)

        if (fs.existsSync(file)) {
          console.log("Found");
          envData = JSON.parse(fs.readFileSync(file));
          for (let key in envData) {
            process.env[key] = envData[key];
          }
        }
      });
    }
  }
}

module.exports = Env;
