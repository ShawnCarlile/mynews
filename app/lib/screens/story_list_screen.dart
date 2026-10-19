import 'package:flutter/material.dart';

import '../api.dart';
import '../config.dart';
import '../format.dart';
import '../models.dart';
import '../widgets.dart';
import 'story_detail_screen.dart';

class StoryListScreen extends StatefulWidget {
  const StoryListScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<StoryListScreen> createState() => _StoryListScreenState();
}

class _StoryListScreenState extends State<StoryListScreen> {
  Loaded<StoryList>? _result;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.api.stories();
      if (!mounted) return;
      setState(() {
        _result = result;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My News', style: TextStyle(fontWeight: FontWeight.w800)),
        actions: [
          IconButton(tooltip: 'Refresh', icon: const Icon(Icons.refresh), onPressed: _loading ? null : _load),
          IconButton(tooltip: 'About', icon: const Icon(Icons.info_outline), onPressed: () => _showAbout(context)),
        ],
      ),
      body: SafeArea(child: _body()),
    );
  }

  Widget _body() {
    if (_loading && _result == null) return const LoadingView(label: 'Loading top stories…\nIf the server was idle, this can take up to a minute.');
    if (_error != null && _result == null) {
      return MessageView(
        icon: Icons.wifi_off,
        title: 'Could not load stories',
        message: '$_error\nCheck your connection and try again.',
        actionLabel: 'Retry',
        onAction: _load,
      );
    }
    final result = _result!;
    final list = result.data;

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          if (_loading) const LinearProgressIndicator(),
          if (result.fromCache) OfflineBanner(syncedAt: result.syncedAt, reason: result.offlineReason, onRetry: _load),
          _CollectionStatus(info: list.collection),
          if (list.stories.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 40),
              child: MessageView(
                icon: Icons.inbox_outlined,
                title: 'No stories right now',
                message: 'The server has no stories from the last seven days yet. Pull down to refresh after the next hourly update.',
              ),
            ),
          for (final story in list.stories) _StoryCard(story: story, onTap: () => _open(story)),
          if (list.stories.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                'Newest first, wider coverage ranked higher · Most recent seven days · ${list.stories.length} ${list.stories.length == 1 ? 'story' : 'stories'}',
                textAlign: TextAlign.center,
                style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
            ),
        ],
      ),
    );
  }

  void _open(StoryListItem story) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => StoryDetailScreen(api: widget.api, storyId: story.id, initialHeadline: story.headline)));
  }

  void _showAbout(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('About My News (beta)', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 12),
              const Text(
                'My News groups coverage of the same event from several publishers. Stories, background links, and AI summaries are prepared by the My News server once per hour and shared by every reader.\n\n'
                'AI-generated text is always labeled and is based only on publisher feed excerpts. Publisher and background pages open in your browser and need an internet connection.',
              ),
              const SizedBox(height: 12),
              Text('Version $appVersion\nServer: $apiBaseUrl', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                icon: const Icon(Icons.bug_report_outlined),
                label: const Text('Report a problem'),
                onPressed: () => openExternal(context, feedbackUrl),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CollectionStatus extends StatelessWidget {
  const _CollectionStatus({required this.info});

  final CollectionInfo info;

  @override
  Widget build(BuildContext context) {
    final muted = TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 14);
    final run = info.lastRun;
    final warnings = <String>[];
    if (run != null && run.outcome == 'failed') warnings.add('The latest server update failed; showing the last successful results.');
    if (run != null && run.failedFeeds.isNotEmpty) warnings.add('Some sources were unavailable in the latest update.');
    final stale = info.lastSuccessfulAt != null && DateTime.now().difference(info.lastSuccessfulAt!) > const Duration(hours: 3);
    if (stale) warnings.add('News has not been updated for over 3 hours.');

    return Padding(
      padding: const EdgeInsets.only(bottom: 8, left: 4, right: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Top stories', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
          Text(
            info.lastSuccessfulAt == null ? 'Not updated yet' : 'Updated ${friendlyTime(info.lastSuccessfulAt)}',
            style: muted,
          ),
          for (final w in warnings)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Row(
                children: [
                  const Icon(Icons.warning_amber_rounded, size: 18, color: Color(0xFF9A5B00)),
                  const SizedBox(width: 6),
                  Expanded(child: Text(w, style: const TextStyle(color: Color(0xFF6B3F00), fontSize: 13.5))),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _StoryCard extends StatelessWidget {
  const _StoryCard({required this.story, required this.onTap});

  final StoryListItem story;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: scheme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: scheme.outlineVariant)),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (story.isFixture) const Padding(padding: EdgeInsets.only(bottom: 6), child: FixtureTag()),
                Text(story.headline, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, height: 1.3)),
                const SizedBox(height: 8),
                Text(
                  '${plural(story.publisherCount, 'publisher')} | ${friendlyTime(story.latestArticleAt)}',
                  style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 14, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 2),
                Text(story.publishers.join(' · '), style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13.5)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
