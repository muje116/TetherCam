import 'package:flutter_test/flutter_test.dart';
import 'package:tethercam_mobile/main.dart';

void main() {
  testWidgets('Discovery page renders', (WidgetTester tester) async {
    await tester.pumpWidget(const TetherCamApp());
    expect(find.text('TetherCam Connect'), findsOneWidget);
  });
}
