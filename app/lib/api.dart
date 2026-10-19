import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'config.dart';
import 'models.dart';

/// A server result, possibly served from the local cache when the server is unreachable.
class Loaded<T> {
  Loaded({required this.data, required this.syncedAt, required this.fromCache, this.offlineReason});

  final T data;
  final DateTime syncedAt;
  final bool fromCache;
  final String? offlineReason;
}

class ApiException implements Exception {
  ApiException(this.message, {this.notFound = false});

  final String message;
  final bool notFound;

  @override
  String toString() => message;
}

/// Reads stored results from the My News server. It never contacts news publishers or the AI service.
class ApiClient {
  ApiClient({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _base = (baseUrl ?? apiBaseUrl).replaceAll(RegExp(r'/+$'), '');

  final http.Client _client;
  final String _base;

  Future<Loaded<StoryList>> stories() => _load('/stories', (j) => StoryList.fromJson(j));

  Future<Loaded<StoryDetail>> story(String id) => _load('/stories/${Uri.encodeComponent(id)}', (j) => StoryDetail.fromJson(j));

  Future<Loaded<T>> _load<T>(String path, T Function(Map<String, dynamic>) parse) async {
    try {
      final response = await _client.get(Uri.parse('$_base$path'), headers: {'Accept': 'application/json'}).timeout(requestTimeout);
      if (response.statusCode == 404) {
        await _forget(path);
        final body = _tryJson(response.body);
        throw ApiException(body?['message'] as String? ?? 'This story is no longer available.', notFound: true);
      }
      if (response.statusCode != 200) {
        throw ApiException('The My News server had a problem (error ${response.statusCode}).');
      }
      final json = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
      final now = DateTime.now();
      await _remember(path, json, now);
      return Loaded(data: parse(json), syncedAt: now, fromCache: false);
    } on ApiException catch (e) {
      if (e.notFound) rethrow;
      return _fromCache(path, parse, e.message);
    } on TimeoutException {
      return _fromCache(path, parse, 'The server took too long to respond.');
    } on http.ClientException {
      return _fromCache(path, parse, 'No connection to the My News server.');
    } on FormatException {
      return _fromCache(path, parse, 'The server sent an unreadable response.');
    }
  }

  Future<Loaded<T>> _fromCache<T>(String path, T Function(Map<String, dynamic>) parse, String reason) async {
    final cached = await _recall(path);
    if (cached == null) throw ApiException(reason);
    // Parsing re-applies the seven-day filter, so expired items are hidden even offline.
    return Loaded(data: parse(cached.$1), syncedAt: cached.$2, fromCache: true, offlineReason: reason);
  }

  Map<String, dynamic>? _tryJson(String body) {
    try {
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  static const _prefix = 'cache:v1:';

  Future<void> _remember(String path, Map<String, dynamic> json, DateTime at) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('$_prefix$path', jsonEncode({'synced_at': at.toUtc().toIso8601String(), 'body': json}));
    } catch (_) {
      // Caching is best-effort; the live result is still shown.
    }
  }

  Future<(Map<String, dynamic>, DateTime)?> _recall(String path) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString('$_prefix$path');
      if (raw == null) return null;
      final entry = jsonDecode(raw) as Map<String, dynamic>;
      return (entry['body'] as Map<String, dynamic>, DateTime.parse(entry['synced_at'] as String).toLocal());
    } catch (_) {
      return null;
    }
  }

  Future<void> _forget(String path) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('$_prefix$path');
    } catch (_) {}
  }
}
