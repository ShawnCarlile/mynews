import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../widgets.dart';
import 'ai_analysis_screen.dart';
import 'publisher_articles_screen.dart';

class StoryDetailScreen extends StatefulWidget {
  const StoryDetailScreen({super.key, required this.api, required this.storyId, required this.initialHeadline});

  final ApiClient api;
  final String storyId;
  final String initialHeadline;

  @override
  State<StoryDetailScreen> createState() => _StoryDetailScreenState();
}

class _StoryDetailScreenState extends State<StoryDetailScreen> {
  Loaded<StoryDetail>? _result;
  String? _error;
  bool _notFound = false;
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
      final result = await widget.api.story(widget.storyId);
      if (!mounted) return;
      setState(() {
        _result = result;
        _loading = false;
        _notFound = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _notFound = e.notFound;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Story'), leading: const BackButton()),
      body: SafeArea(child: _body()),
    );
  }

  Widget _body() {
    if (_loading && _result == null) return const LoadingView(label: 'Loading story…');
    if (_error != null && (_result == null || _notFound)) {
      return MessageView(
        icon: _notFound ? Icons.history_toggle_off : Icons.wifi_off,
        title: _notFound ? 'Story no longer available' : 'Could not load this story',
        message: _notFound ? _error! : '$_error\nCheck your connection and try again.',
        actionLabel: _notFound ? 'Back to stories' : 'Retry',
        onAction: _notFound ? () => Navigator.of(context).pop() : _load,
      );
    }
    final result = _result!;
    final story = result.data;
    if (story.articles.isEmpty) {
      return MessageView(
        icon: Icons.history_toggle_off,
        title: 'Story no longer available',
        message: 'All coverage of this story is older than seven days.',
        actionLabel: 'Back to stories',
        onAction: () => Navigator.of(context).pop(),
      );
    }
    final scheme = Theme.of(context).colorScheme;
    final publishers = story.publishers;

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          if (_loading) const LinearProgressIndicator(),
          if (result.fromCache) OfflineBanner(syncedAt: result.syncedAt, reason: result.offlineReason, onRetry: _load),
          if (story.isFixture) const Padding(padding: EdgeInsets.only(bottom: 8), child: FixtureTag()),
          Text(story.headline, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800, height: 1.25)),
          const SizedBox(height: 6),
          Text(
            '${plural(publishers.length, 'publisher')} · ${plural(story.articles.length, 'article')} · Latest ${friendlyTime(story.latestArticleAt)}',
            style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 14),
          ),
          const SizedBox(height: 14),
          _Overview(story: story),

          const SectionHeader('Original coverage'),
          for (final p in publishers)
            ActionTile(
              icon: Icons.newspaper,
              label: p.name,
              subtitle: p.articles.length == 1 ? p.articles.first.title : '${p.articles.length} articles on this story',
              action: p.articles.length == 1 ? 'Open' : 'View',
              onTap: () => p.articles.length == 1
                  ? openExternal(context, p.articles.first.url)
                  : Navigator.of(context).push(MaterialPageRoute(builder: (_) => PublisherArticlesScreen(publisher: p))),
            ),

          const SectionHeader('Background'),
          if (story.background.isEmpty)
            const InfoCard(child: Text('No background resource available'))
          else
            for (final b in story.background)
              ActionTile(icon: Icons.menu_book_outlined, label: b.title, subtitle: b.description, action: 'Open', onTap: () => openExternal(context, b.url)),

          const SectionHeader('AI analysis', trailing: AiTag()),
          ActionTile(
            icon: Icons.auto_awesome_outlined,
            label: 'Overview and perspectives',
            subtitle: _aiSubtitle(story.summary),
            action: 'View',
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => AiAnalysisScreen(story: story))),
          ),
          const SizedBox(height: 8),
          Text(
            'Source buttons appear only for publishers that covered this story. Publisher pages open in your browser.',
            style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13),
          ),
        ],
      ),
    );
  }

  String _aiSubtitle(AiSummary s) {
    switch (s.status) {
      case 'current':
        return 'Generated ${friendlyTime(s.generatedAt)}';
      case 'stale':
        return 'Generated ${friendlyTime(s.generatedAt)} · newer coverage not yet included';
      case 'outdated':
        return 'Being rebuilt after older coverage expired';
      case 'failed':
        return 'Unavailable right now';
      default:
        return 'Not generated yet';
    }
  }
}

/// The overview shows the AI synthesis when one is available (labeled), otherwise the newest
/// publisher's own feed excerpt (labeled as original wording).
class _Overview extends StatelessWidget {
  const _Overview({required this.story});

  final StoryDetail story;

  @override
  Widget build(BuildContext context) {
    final summary = story.summary;
    final muted = TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 13);
    if (summary.hasContent) {
      return InfoCard(
        title: 'Story overview',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(summary.overview!),
            const SizedBox(height: 10),
            Row(children: [const AiTag(), const SizedBox(width: 8), Expanded(child: Text('From feed excerpts · ${friendlyTime(summary.generatedAt)}', style: muted))]),
          ],
        ),
      );
    }
    final lead = story.articles.firstWhere((a) => a.excerpt.isNotEmpty, orElse: () => story.articles.first);
    return InfoCard(
      title: 'Story overview',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(lead.excerpt.isNotEmpty ? '“${lead.excerpt}”' : lead.title),
          const SizedBox(height: 10),
          Text('Feed excerpt from ${lead.publisherName} (original wording). ${summary.message ?? ''}', style: muted),
        ],
      ),
    );
  }
}
