// semgrep --test fixture for dart.yml. "ruleid" lines must match; "ok" lines must not.
import 'package:flutter/material.dart';

void colours(BuildContext context) {
  // ruleid: std.dart.raw-color
  final a = Color(0xFF00FF00);
  // ruleid: std.dart.raw-color
  final b = Color.fromARGB(255, 0, 0, 0);
  // ok: std.dart.raw-color
  final c = context.colors.statusDanger;
  // ruleid: std.dart.material-colors
  final d = Colors.red;
  // ok: std.dart.material-colors
  final e = Colors.transparent;
  // ok: std.dart.material-colors
  final f = 1; // Colors.red mentioned in a comment is fine
}

Widget styles() {
  // ruleid: std.dart.style-literal
  const s = TextStyle(fontSize: 14);
  // ruleid: std.dart.style-literal
  const p = EdgeInsets.all(12);
  // ruleid: std.dart.style-literal
  const q = EdgeInsets.symmetric(horizontal: 8);
  // ok: std.dart.style-literal
  const r = EdgeInsets.all(AppSpace.md);
  // ok: std.dart.style-literal
  const z = EdgeInsets.all(0);
  // ruleid: std.dart.icons-direct
  return Icon(Icons.add);
}

Widget good() {
  // ok: std.dart.icons-direct
  return Icon(AppIcons.actionAdd);
}

Future<void> misc(SharedPreferences prefs) async {
  // ruleid: std.dart.print
  print('hello');
  // ruleid: std.dart.print
  debugPrint('x');
  // ok: std.dart.print
  log.info('hello');
  // ruleid: std.dart.env-read
  final k = String.fromEnvironment('API_URL');
  // ruleid: std.dart.raw-http
  await http.get(Uri.parse('https://x'));
  // ruleid: std.dart.raw-http
  final dio = Dio();
  // ok: std.dart.raw-http
  await api.get('/things');
  // ruleid: std.dart.insecure-token-storage
  await prefs.setString('auth_token', t);
  // ok: std.dart.insecure-token-storage
  await prefs.setString('theme_mode', 'dark');
  // ruleid: std.dart.tls-bypass
  client.badCertificateCallback = (cert, host, port) => true;
  try {
    work();
  // ruleid: std.dart.empty-catch
  } catch (e) {}
  try {
    work();
  // ok: std.dart.empty-catch
  } catch (e, st) { log.error('work.failed', e, st); }
}
