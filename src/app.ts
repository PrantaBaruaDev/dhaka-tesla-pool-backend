import express, { type Application } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { errorHandler } from './middleware/error.handler';
import config from './app/config';
import passport from 'passport';
import "./app/lib/passport";
import { authRouter } from './app/modules/auth/auth.routes';
import { zonesRouter } from './app/modules/zones/zones.routes';
import { requestLogger } from './middleware/request-logger';
import { ridesRouter } from './app/modules/rides/rides.routes';
import { driverRouter } from './app/modules/driver/driver.routes';

const app: Application = express();
// app.use(helmet());
app.use(
	cors({
		origin: config.cors_origin,
		credentials: true,
		methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
	}),
);

// Enable URL-encoded form data parsing
app.use(express.urlencoded({ extended: true }));

// Middleware to parse JSON bodies
app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());

app.use(requestLogger);

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/zones', zonesRouter);
app.use('/api/v1/rides', ridesRouter);
app.use('/api/v1/driver', driverRouter);

app.use(errorHandler);

export default app;