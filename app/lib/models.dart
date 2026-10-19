import 'config.dart';

DateTime? _date(dynamic v) => v == null ? null : DateTime.tryParse(v as String)?.toLocal();

List<String> _strings(dynamic v) => v is List ? v.map((e) => e.toString()).toList() : const [];

bool isExpired(DateTime? published, DateTime now) =>
    published == null || published.isBefore(now.subtract(retentionWindow));

class RunInfo {
  RunInfo({required this.outcome, this.startedAt, this.finishedAt, required this.failedFeeds});

  final String outcome;
  final DateTime? startedAt;
  final DateTime? finishedAt;
  final List<String> failedFeeds;

  factory RunInfo.fromJson(Map<String, dynamic> j) => RunInfo(
        outcome: j['outcome'] as String? ?? 'unknown',
        startedAt: _date(j['started_at']),
        finishedAt: _date(j['finished_at']),
        failedFeeds: (j['feeds'] as List? ?? [])
            .where((f) => f is Map && f['ok'] == false)
            .map((f) => (f as Map)['publisher'].toString())
            .toList(),
      );
}

class CollectionInfo {
  CollectionInfo({this.lastSuccessfulAt, this.lastRun});

  final DateTime? lastSuccessfulAt;
  final RunInfo? lastRun;

  factory CollectionInfo.fromJson(Map<String, dynamic>? j) => CollectionInfo(
        lastSuccessfulAt: _date(j?['last_successful_at']),
        lastRun: j?['last_run'] is Map<String, dynamic> ? RunInfo.fromJson(j!['last_run']) : null,
      );
}

class StoryListItem {
  StoryListItem({
    required this.id,
    required this.headline,
    required this.latestArticleAt,
    required this.publisherCount,
    required this.articleCount,
    required this.publishers,
    required this.summaryStatus,
    required this.isFixture,
  });

  final String id;
  final String headline;
  final DateTime? latestArticleAt;
  final int publisherCount;
  final int articleCount;
  final List<String> publishers;
  final String summaryStatus;
  final bool isFixture;

  factory StoryListItem.fromJson(Map<String, dynamic> j) => StoryListItem(
        id: j['id'] as String,
        headline: j['headline'] as String? ?? '',
        latestArticleAt: _date(j['latest_article_at']),
        publisherCount: j['publisher_count'] as int? ?? 0,
        articleCount: j['article_count'] as int? ?? 0,
        publishers: _strings(j['publishers']),
        summaryStatus: j['summary_status'] as String? ?? 'pending',
        isFixture: j['is_fixture'] == true,
      );
}

class StoryList {
  StoryList({required this.stories, required this.collection, required this.ordering});

  final List<StoryListItem> stories;
  final CollectionInfo collection;
  final String ordering;

  factory StoryList.fromJson(Map<String, dynamic> j, {DateTime? now}) {
    final at = now ?? DateTime.now();
    return StoryList(
      stories: (j['stories'] as List? ?? [])
          .map((e) => StoryListItem.fromJson(e as Map<String, dynamic>))
          // Safety net for cached data: never show a story whose newest article has expired.
          .where((s) => !isExpired(s.latestArticleAt, at))
          .toList(),
      collection: CollectionInfo.fromJson(j['collection'] as Map<String, dynamic>?),
      ordering: j['ordering'] as String? ?? 'newest first',
    );
  }
}

class Article {
  Article({
    required this.id,
    required this.publisherId,
    required this.publisherName,
    required this.title,
    required this.url,
    required this.publishedAt,
    required this.excerpt,
  });

  final String id;
  final String publisherId;
  final String publisherName;
  final String title;
  final String url;
  final DateTime? publishedAt;
  final String excerpt;

  factory Article.fromJson(Map<String, dynamic> j) => Article(
        id: j['id'] as String,
        publisherId: j['publisher_id'] as String,
        publisherName: j['publisher_name'] as String,
        title: j['title'] as String? ?? '',
        url: j['url'] as String,
        publishedAt: _date(j['published_at']),
        excerpt: j['excerpt'] as String? ?? '',
      );
}

class BackgroundLink {
  BackgroundLink({required this.title, required this.url, this.description, required this.provider});

  final String title;
  final String url;
  final String? description;
  final String provider;

  factory BackgroundLink.fromJson(Map<String, dynamic> j) => BackgroundLink(
        title: j['title'] as String,
        url: j['url'] as String,
        description: j['description'] as String?,
        provider: j['provider'] as String? ?? '',
      );
}

class Perspective {
  Perspective({required this.label, required this.summary, required this.evidenceLimits, required this.articleIds});

  final String label;
  final String summary;
  final String evidenceLimits;
  final List<String> articleIds;

  factory Perspective.fromJson(Map<String, dynamic> j) => Perspective(
        label: j['label'] as String? ?? 'Perspective',
        summary: j['summary'] as String? ?? '',
        evidenceLimits: j['evidence_limits'] as String? ?? '',
        articleIds: _strings(j['article_ids']),
      );
}

class AiSummary {
  AiSummary({
    required this.status,
    this.message,
    this.version,
    this.generatedAt,
    this.model,
    this.inputScopeNote,
    required this.inputArticleIds,
    this.overview,
    this.agreement,
    this.disagreement,
    this.uncertainty,
    required this.overviewArticleIds,
    this.perspectivesStatus,
    this.perspectivesMessage,
    required this.perspectives,
  });

  /// current | stale | outdated | failed | pending
  final String status;
  final String? message;
  final int? version;
  final DateTime? generatedAt;
  final String? model;
  final String? inputScopeNote;
  final List<String> inputArticleIds;
  final String? overview;
  final String? agreement;
  final String? disagreement;
  final String? uncertainty;
  final List<String> overviewArticleIds;
  final String? perspectivesStatus;
  final String? perspectivesMessage;
  final List<Perspective> perspectives;

  bool get hasContent => overview != null && overview!.isNotEmpty;

  factory AiSummary.fromJson(Map<String, dynamic>? j) {
    if (j == null) {
      return AiSummary(status: 'pending', inputArticleIds: const [], overviewArticleIds: const [], perspectives: const []);
    }
    return AiSummary(
      status: j['status'] as String? ?? 'pending',
      message: j['message'] as String?,
      version: j['version'] as int?,
      generatedAt: _date(j['generated_at']),
      model: j['model'] as String?,
      inputScopeNote: j['input_scope_note'] as String?,
      inputArticleIds: _strings(j['input_article_ids']),
      overview: j['overview'] as String?,
      agreement: j['agreement'] as String?,
      disagreement: j['disagreement'] as String?,
      uncertainty: j['uncertainty'] as String?,
      overviewArticleIds: _strings(j['overview_article_ids']),
      perspectivesStatus: j['perspectives_status'] as String?,
      perspectivesMessage: j['perspectives_message'] as String?,
      perspectives: (j['perspectives'] as List? ?? [])
          .map((e) => Perspective.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  AiSummary withheld(String reason) => AiSummary(
        status: 'outdated',
        message: reason,
        inputArticleIds: const [],
        overviewArticleIds: const [],
        perspectives: const [],
      );
}

class PublisherGroup {
  PublisherGroup({required this.id, required this.name, required this.articles});

  final String id;
  final String name;
  final List<Article> articles;
}

class StoryDetail {
  StoryDetail({
    required this.id,
    required this.headline,
    required this.latestArticleAt,
    required this.isFixture,
    required this.articles,
    required this.background,
    required this.summary,
    required this.collection,
  });

  final String id;
  final String headline;
  final DateTime? latestArticleAt;
  final bool isFixture;
  final List<Article> articles;
  final List<BackgroundLink> background;
  final AiSummary summary;
  final CollectionInfo collection;

  /// One group per publisher that actually covered the story, alphabetical.
  List<PublisherGroup> get publishers {
    final map = <String, PublisherGroup>{};
    for (final a in articles) {
      map.putIfAbsent(a.publisherId, () => PublisherGroup(id: a.publisherId, name: a.publisherName, articles: []));
      map[a.publisherId]!.articles.add(a);
    }
    return map.values.toList()..sort((a, b) => a.name.compareTo(b.name));
  }

  Article? articleById(String id) {
    for (final a in articles) {
      if (a.id == id) return a;
    }
    return null;
  }

  factory StoryDetail.fromJson(Map<String, dynamic> j, {DateTime? now}) {
    final at = now ?? DateTime.now();
    final all = (j['articles'] as List? ?? []).map((e) => Article.fromJson(e as Map<String, dynamic>)).toList();
    final active = all.where((a) => !isExpired(a.publishedAt, at)).toList();
    var summary = AiSummary.fromJson(j['summary'] as Map<String, dynamic>?);
    // Cached copies can outlive articles. Never show a summary built on an article that has since expired.
    final activeIds = active.map((a) => a.id).toSet();
    if (summary.hasContent && summary.inputArticleIds.any((id) => !activeIds.contains(id))) {
      summary = summary.withheld('This saved AI summary used coverage that has since expired. Reconnect to load the updated summary.');
    }
    return StoryDetail(
      id: j['id'] as String,
      headline: j['headline'] as String? ?? '',
      latestArticleAt: active.isEmpty ? null : active.first.publishedAt,
      isFixture: j['is_fixture'] == true,
      articles: active,
      background: (j['background'] as List? ?? []).map((e) => BackgroundLink.fromJson(e as Map<String, dynamic>)).toList(),
      summary: summary,
      collection: CollectionInfo.fromJson(j['collection'] as Map<String, dynamic>?),
    );
  }
}
