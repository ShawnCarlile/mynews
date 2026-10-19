/// Build-time configuration. Set the deployed API with:
///   flutter build apk --release --dart-define=API_BASE_URL=https://your-service.onrender.com
/// The app holds no secrets: it only reads the public, read-only API.
const String apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:8080', // Android emulator -> host machine
);

const String appVersion = '1.0.0+1';

/// Must match the server's rolling window. Used to hide expired cached content while offline.
const Duration retentionWindow = Duration(hours: 168);

// Generous because a free-tier server can take up to a minute to wake from sleep.
const Duration requestTimeout = Duration(seconds: 60);

/// Where beta testers report problems (shown on the About sheet).
const String feedbackUrl = String.fromEnvironment(
  'FEEDBACK_URL',
  defaultValue: 'https://github.com/',
);
