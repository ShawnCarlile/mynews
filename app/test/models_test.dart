import 'package:flutter_test/flutter_test.dart';
import 'package:my_news/models.dart';

void main() {
  final now = DateTime.utc(2026, 10, 19, 12);
  String ago(int hours) => now.subtract(Duration(hours: hours)).toIso8601String();

  Map<String, dynamic> article(String id, String publisher, int hoursAgo) => {
        'id': id,
        'publisher_id': publisher,
        'publisher_name': publisher.toUpperCase(),
        'title': 'Title $id',
        'url': 'https://example.com/$id',
        'published_at': ago(hoursAgo),
        'excerpt': 'Excerpt $id',
      };

  test('cached story list hides stories whose newest article expired', () {
    final list = StoryList.fromJson({
      'stories': [
        {'id': 'a', 'headline': 'Fresh', 'latest_article_at': ago(2), 'publisher_count': 2},
        {'id': 'b', 'headline': 'Expired', 'latest_article_at': ago(170), 'publisher_count': 1},
      ],
    }, now: now);
    expect(list.stories.map((s) => s.id), ['a']);
  });

  test('cached detail drops expired articles and withholds summaries that used them', () {
    final detail = StoryDetail.fromJson({
      'id': 's1',
      'headline': 'Fire',
      'articles': [article('x', 'fox', 3), article('y', 'npr', 169)],
      'background': [],
      'summary': {
        'status': 'current',
        'overview': 'AI text',
        'input_article_ids': ['x', 'y'],
        'overview_article_ids': ['x', 'y'],
        'perspectives': [],
      },
    }, now: now);
    expect(detail.publishers.map((p) => p.id), ['fox']);
    expect(detail.summary.hasContent, isFalse);
    expect(detail.summary.status, 'outdated');
  });

  test('publishers group multiple articles from the same outlet', () {
    final detail = StoryDetail.fromJson({
      'id': 's1',
      'headline': 'Fire',
      'articles': [article('x', 'fox', 3), article('z', 'fox', 4), article('w', 'bbc', 5)],
      'summary': null,
    }, now: now);
    final groups = detail.publishers;
    expect(groups.map((g) => g.name), ['BBC', 'FOX']);
    expect(groups.last.articles.length, 2);
    expect(detail.summary.status, 'pending');
  });
}
